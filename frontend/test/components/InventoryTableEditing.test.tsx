import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InventoryItemList } from "../../src/components/InventoryItemList";
import { TableEditSessionContext } from "../../src/components/tableEditSession";
import { useInventoryItems } from "../../src/hooks/useInventoryItems";
import { getInventoryConfiguration } from "../../src/services/inventoryEditor";
import {
  getInventoryItems,
  updateInventoryItems,
} from "../../src/services/inventoryItems";
import { ApiError } from "../../src/services/api";
import { filterField, filterItem } from "../helpers/itemFilters";
import type { InventoryItem } from "../../src/types/inventoryItem";
import type { InventoryField } from "../../src/types/inventoryField";

vi.mock("../../src/services/inventoryItems", () => ({
  getInventoryItems: vi.fn(),
  updateInventoryItems: vi.fn(),
  updateInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
}));
vi.mock("../../src/services/inventoryEditor", () => ({
  getInventoryConfiguration: vi.fn(),
}));

const fields = [
  { ...filterField("text", "Title"), max_length: 80, is_required: true },
  filterField("number", "Quantity"),
  filterField("boolean", "Available"),
  filterField("checkbox", "Checked"),
  filterField("select", "Type"),
  filterField("multiselect", "Tags"),
  filterField("url", "Link"),
  filterField("duration", "Elapsed"),
  filterField("date", "Date"),
  filterField("time", "Time"),
  filterField("datetime", "Timestamp"),
  filterField("id", "ID"),
];
const inventory = {
  id: "inventory",
  name: "Inventory",
  description: null,
  configuration_revision: 7,
  created_at: "",
  updated_at: "",
};
const original = filterItem(
  {
    "text-field": "First",
    "number-field": 2,
    "boolean-field": true,
    "checkbox-field": false,
    "select-field": "option-0",
    "multiselect-field": ["option-1"],
    "url-field": { url: "https://example.com", label: "Hidden link" },
    "duration-field": 3600,
    "date-field": "2026-10-26",
    "time-field": "13:45",
    "datetime-field": "2026-W44-1T13:45+02:00",
    "id-field": 42,
  },
  "first",
);
let serverItems: InventoryItem[];
beforeEach(() => {
  serverItems = [
    structuredClone(original),
    {
      ...structuredClone(original),
      id: "second",
      revision: 3,
      values: original.values.map((value) =>
        value.field_id === "text-field"
          ? { ...value, value: "Second" }
          : { ...value },
      ),
    },
  ];
  vi.mocked(getInventoryConfiguration).mockResolvedValue({ inventory, fields });
  vi.mocked(getInventoryItems).mockImplementation(async () => serverItems);
  vi.mocked(updateInventoryItems).mockImplementation(async (_id, input) => {
    const saved = input.items.map((change) => ({
      ...serverItems.find((item) => item.id === change.item_id)!,
      revision: change.expected_revision + 1,
      values: [
        ...change.values.map((value, index) => ({
          id: `${change.item_id}-saved-${index}`,
          ...value,
          created_at: "",
          updated_at: "",
        })),
        original.values.find((value) => value.field_id === "id-field")!,
      ],
    }));
    serverItems = serverItems.map(
      (item) => saved.find((row) => row.id === item.id) ?? item,
    );
    return saved;
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/**
 * Mount a live query-backed table so successful atomic writes update the rendered rows.
 * @param currentFields Field overrides used to exercise hidden required values.
 * @param routed Whether to enable actual blocked route navigation.
 * @returns Query client, render result, and optional memory data router.
 */
function renderTable(currentFields: InventoryField[] = fields, routed = false) {
  vi.mocked(getInventoryConfiguration).mockResolvedValue({
    inventory,
    fields: currentFields,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["inventories", "inventory", "items"], serverItems);
  function Table() {
    const [locked, setLocked] = useState<string | null>(null);
    const query = useInventoryItems("inventory");
    return (
      <TableEditSessionContext.Provider
        value={{ inventoryId: locked, setInventoryId: setLocked }}
      >
        <button disabled={locked !== null}>Inventory settings</button>
        {routed && <Link to="/other">Other inventory</Link>}
        <InventoryItemList
          inventoryId="inventory"
          fields={currentFields}
          items={query.data ?? []}
          actions={<button>New item</button>}
        />
      </TableEditSessionContext.Provider>
    );
  }
  const router = routed
    ? createMemoryRouter([
        { path: "/", element: <Table /> },
        { path: "/other", element: <p>Other page</p> },
      ])
    : null;
  return {
    client,
    router,
    ...render(
      <QueryClientProvider client={client}>
        {router ? <RouterProvider router={router} /> : <Table />}
      </QueryClientProvider>,
    ),
  };
}

/** Find a source data row independently of the separate action table. */
function row(id = "first") {
  return document.querySelector<HTMLTableRowElement>(
    `tr[data-item-id="${id}"]`,
  )!;
}
/** Start a table edit and wait for its typed cell controls. */
async function start(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit table" }));
  await waitFor(() =>
    expect(within(row()).getByRole("textbox", { name: "Title" })).toBeVisible(),
  );
}

// Test typed edits save once, omit read-only IDs and retain hidden structured and legacy values.
test("saves changed cells atomically and preserves hidden values, original versions and IDs", async () => {
  localStorage.setItem(
    "inventory-manager-view:inventory",
    JSON.stringify({
      version: 1,
      hiddenFieldIds: ["url-field", "datetime-field"],
      columnWidths: { "text-field": 90 },
    }),
  );
  const user = userEvent.setup();
  renderTable();
  await start(user);
  expect(
    screen.getByRole("button", { name: "Inventory settings" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "New item" })).toBeDisabled();
  expect(
    within(row()).queryByRole("textbox", { name: "ID" }),
  ).not.toBeInTheDocument();
  expect(within(row()).getByText("42")).toBeVisible();
  const title = within(row()).getByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "Changed");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Edit table" })).toBeEnabled(),
  );
  expect(updateInventoryItems).toHaveBeenCalledTimes(1);
  const payload = vi.mocked(updateInventoryItems).mock.calls[0][1];
  expect(payload.expected_configuration_revision).toBe(7);
  expect(payload.items).toHaveLength(1);
  expect(payload.items[0]).toMatchObject({
    item_id: "first",
    expected_revision: 1,
  });
  expect(payload.items[0].values).toContainEqual({
    field_id: "url-field",
    value: { url: "https://example.com", label: "Hidden link" },
  });
  expect(payload.items[0].values).toContainEqual({
    field_id: "datetime-field",
    value: "2026-W44-1T13:45+02:00",
  });
  expect(
    payload.items[0].values.some((value) => value.field_id === "id-field"),
  ).toBe(false);
  expect(within(row()).getByText("Changed")).toBeVisible();
  expect(
    JSON.parse(localStorage.getItem("inventory-manager-view:inventory")!)
      .columnWidths,
  ).toEqual({ "text-field": 90 });
});

// Test one Save combines multiple row revisions and keeps false/zero as real typed values.
// Test valid legacy clocks outside native-input syntax remain visible and unchanged.
test("keeps legacy midnight values visible without clearing them", async () => {
  serverItems = serverItems.map((item) => ({
    ...item,
    values: item.values.map((value) =>
      value.field_id === "time-field" ? { ...value, value: "24:00" } : value,
    ),
  }));
  const user = userEvent.setup();
  renderTable();
  await start(user);
  expect(within(row()).getByRole("textbox", { name: "Time" })).toHaveValue(
    "24:00",
  );
  const title = within(row()).getByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "Changed");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(updateInventoryItems).toHaveBeenCalledOnce());
  expect(
    vi.mocked(updateInventoryItems).mock.calls[0][1].items[0].values,
  ).toContainEqual({ field_id: "time-field", value: "24:00" });
});

// Test one Save combines multiple row revisions and keeps false/zero as real typed values.
test("combines multiple rows and typed cell edits", async () => {
  const user = userEvent.setup();
  renderTable();
  await start(user);
  const quantity = within(row()).getByRole("textbox", { name: "Quantity" });
  await user.clear(quantity);
  await user.type(quantity, "0");
  await user.click(within(row()).getByRole("checkbox", { name: "Checked" }));
  const secondTitle = within(row("second")).getByRole("textbox", {
    name: "Title",
  });
  await user.clear(secondTitle);
  await user.type(secondTitle, "Other");
  const type = within(row()).getByRole("combobox", { name: "Type" });
  await user.click(type);
  await user.click(screen.getByRole("option", { name: "Cable" }));
  const available = within(row()).getByRole("combobox", { name: "Available" });
  await user.click(available);
  await user.click(screen.getByRole("option", { name: "No" }));
  const hours = within(row()).getByRole("spinbutton", { name: "Hours" });
  await user.clear(hours);
  await user.type(hours, "2");
  const label = within(row()).getByRole("textbox", {
    name: "Link: Link text (optional)",
  });
  await user.clear(label);
  await user.type(label, "New link");
  fireEvent.change(within(row()).getByLabelText("Date"), {
    target: { value: "2026-11-01" },
  });
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(updateInventoryItems).toHaveBeenCalledTimes(1));
  const changes = vi.mocked(updateInventoryItems).mock.calls[0][1].items;
  expect(changes.map((item) => [item.item_id, item.expected_revision])).toEqual(
    [
      ["first", 1],
      ["second", 3],
    ],
  );
  expect(changes[0].values).toEqual(
    expect.arrayContaining([
      { field_id: "number-field", value: 0 },
      { field_id: "checkbox-field", value: true },
      { field_id: "select-field", value: "option-1" },
      { field_id: "duration-field", value: 7200 },
      { field_id: "boolean-field", value: false },
      { field_id: "date-field", value: "2026-11-01" },
      {
        field_id: "url-field",
        value: { url: "https://example.com", label: "New link" },
      },
    ]),
  );
});

// Test cancel and reverting remove changes without submitting a destructive no-op replacement.
test("discards on Cancel and recognizes a returned baseline", async () => {
  const user = userEvent.setup();
  renderTable();
  await start(user);
  const title = within(row()).getByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "Draft");
  await user.clear(title);
  await user.type(title, "First");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.clear(title);
  await user.type(title, "Discard me");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(within(row()).getByText("First")).toBeVisible();
  expect(updateInventoryItems).not.toHaveBeenCalled();
});

// Test field errors stay adjacent to cells and hidden required values can be revealed for repair.
test("validates cells and reveals missing required hidden values", async () => {
  const hidden = {
    ...filterField("text", "Hidden"),
    id: "hidden",
    is_required: true,
  };
  localStorage.setItem(
    "inventory-manager-view:inventory",
    JSON.stringify({ version: 1, hiddenFieldIds: ["hidden"] }),
  );
  const user = userEvent.setup();
  renderTable([...fields, hidden]);
  await start(user);
  const title = within(row()).getByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "Changed");
  await user.click(screen.getByRole("button", { name: "Show Hidden" }));
  const required = within(row()).getByRole("textbox", { name: "Hidden" });
  expect(required).toHaveAttribute("aria-invalid", "true");
  await user.type(required, "Required");
  const quantity = within(row()).getByRole("textbox", { name: "Quantity" });
  await user.clear(quantity);
  await user.type(quantity, "bad");
  expect(within(row()).getByText("Enter a finite number.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.clear(quantity);
  await user.type(quantity, "0");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

// Test stale revisions cannot be silently replaced by a background query refresh or automatic retry.
test("preserves conflict drafts and reloads only after explicit discard", async () => {
  const user = userEvent.setup();
  const { client } = renderTable();
  await start(user);
  const title = within(row()).getByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "Local draft");
  act(() =>
    client.setQueryData(
      ["inventories", "inventory", "items"],
      [
        {
          ...original,
          revision: 5,
          values: original.values.map((value) =>
            value.field_id === "text-field"
              ? { ...value, value: "Remote" }
              : value,
          ),
        },
      ],
    ),
  );
  expect(title).toHaveValue("Local draft");
  vi.mocked(updateInventoryItems).mockRejectedValueOnce(
    new ApiError(409, "Conflict", "inventory_item_conflict", "first"),
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(/Your draft is preserved. Discard it/);
  expect(title).toHaveValue("Local draft");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(
    vi.mocked(updateInventoryItems).mock.calls[0][1].items[0].expected_revision,
  ).toBe(1);
  expect(updateInventoryItems).toHaveBeenCalledTimes(1);
  vi.mocked(getInventoryItems).mockResolvedValueOnce([
    {
      ...original,
      revision: 5,
      values: original.values.map((value) =>
        value.field_id === "text-field" ? { ...value, value: "Remote" } : value,
      ),
    },
  ]);
  await user.click(
    screen.getByRole("button", { name: "Discard inputs and reload" }),
  );
  await waitFor(() =>
    expect(within(row()).getByRole("textbox", { name: "Title" })).toHaveValue(
      "Remote",
    ),
  );
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(updateInventoryItems).toHaveBeenCalledTimes(1);
});

// Test ordinary request failures keep editable drafts and reload/close protection until explicit retry.
test("retains drafts after a failed save and locks inputs during a pending request", async () => {
  const user = userEvent.setup();
  renderTable(fields, true);
  await start(user);
  const title = within(row()).getByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "Draft");
  let reject!: (reason: Error) => void;
  vi.mocked(updateInventoryItems).mockImplementationOnce(
    () =>
      new Promise((_resolve, rejectRequest) => {
        reject = rejectRequest;
      }),
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(title).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("link", { name: "Other inventory" }));
  expect(
    screen.getByRole("button", { name: "Discard and leave" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  await act(async () => reject(new Error("Offline")));
  expect(
    await screen.findByText(/No changes were saved. Your draft is preserved/),
  ).toBeVisible();
  expect(title).toBeEnabled();
  expect(title).toHaveValue("Draft");
});

// Test the real router blocks both link navigation and explicit route changes without losing inputs.
test("asks before leaving and can keep editing or explicitly discard", async () => {
  const user = userEvent.setup();
  const { router } = renderTable(fields, true);
  await start(user);
  const title = within(row()).getByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "Unsaved");
  await user.click(screen.getByRole("link", { name: "Other inventory" }));
  expect(
    screen.getByRole("dialog", { name: "Discard table changes?" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(title).toHaveValue("Unsaved");
  await act(async () => {
    await router!.navigate("/other");
  });
  await user.click(screen.getByRole("button", { name: "Discard and leave" }));
  expect(await screen.findByText("Other page")).toBeVisible();
  expect(updateInventoryItems).not.toHaveBeenCalled();
});

// Test loading failures do not create half-initialized drafts or leave the edit lock stuck.
test("recovers from a failed edit-session load", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryConfiguration).mockRejectedValueOnce(
    new Error("Offline"),
  );
  renderTable();
  await user.click(screen.getByRole("button", { name: "Edit table" }));
  expect(
    await screen.findByText(/table editor could not be loaded/),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Inventory settings" }),
  ).toBeEnabled();
  await start(user);
});
