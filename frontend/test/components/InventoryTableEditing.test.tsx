import { seedView, savedView } from "../helpers/preferences";
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  createEvent,
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
import i18n from "../../src/i18n";
import { chooseOptions } from "../helpers/choices";

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
    if (input.order) {
      for (const row of input.order) {
        if (!("item_id" in row)) continue;
        if (!saved.some((item) => item.id === row.item_id))
          saved.push({
            ...serverItems.find((item) => item.id === row.item_id)!,
            revision: row.expected_revision + 1,
          });
      }
    }
    serverItems = serverItems.map(
      (item) => saved.find((row) => row.id === item.id) ?? item,
    );
    const added = (input.new_items ?? []).map((row, index) => ({
      ...structuredClone(original),
      id: `created-${index}`,
      revision: 1,
      values: row.values.map((value, i) => ({
        ...value,
        id: `created-value-${index}-${i}`,
        created_at: "",
        updated_at: "",
      })),
    }));
    serverItems.push(...added);
    if (input.order) {
      const positions = new Map(
        input.order.map((row, index) => [
          "item_id" in row ? row.item_id : added[row.new_item_index].id,
          index,
        ]),
      );
      serverItems.sort(
        (a, b) =>
          (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity),
      );
    }
    return [...saved, ...added];
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

// Test active search/filter/sort and columns remain stable across edits, language and other-tab changes.
test("freezes row membership, ordering and presentation until editing ends", async () => {
  serverItems[0] = {
    ...serverItems[0],
    values: serverItems[0].values.map((value) =>
      value.field_id === "text-field" ? { ...value, value: "Alpha" } : value,
    ),
  };
  serverItems[1] = {
    ...serverItems[1],
    values: serverItems[1].values.map((value) =>
      value.field_id === "text-field" ? { ...value, value: "Beta" } : value,
    ),
  };
  serverItems.push({
    ...original,
    id: "excluded",
    values: original.values.map((value) =>
      value.field_id === "boolean-field" ? { ...value, value: false } : value,
    ),
  });
  const user = userEvent.setup();
  const { client } = renderTable();
  await user.type(screen.getByRole("searchbox"), "yes");
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.click(screen.getByRole("button", { name: "Add filter" }));
  await chooseOptions(user, "Column", ["Quantity"]);
  await chooseOptions(user, "Condition", ["is at least"]);
  await user.type(screen.getByRole("spinbutton", { name: "Value" }), "2");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  const heading = screen.getByRole("columnheader", { name: "Title" });
  await user.click(within(heading).getByRole("button", { name: "Title" }));
  await user.click(within(heading).getByRole("button", { name: "Title" }));
  await start(user);
  const ids = () =>
    Array.from(document.querySelectorAll<HTMLElement>("tr[data-item-id]")).map(
      (row) => row.dataset.itemId,
    );
  expect(ids()).toEqual(["second", "first"]);
  const title = within(row()).getByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "ZZZ");
  const quantity = within(row()).getByRole("textbox", { name: "Quantity" });
  await user.clear(quantity);
  await user.type(quantity, "0");
  expect(ids()).toEqual(["second", "first"]);
  const table = screen.getAllByRole("table")[0];
  const widths = () =>
    Array.from(table.querySelectorAll("col")).map((col) => col.style.width);
  const before = widths();
  const external = {
    version: 1,
    sort: { fieldId: "number-field", direction: "ascending" },
    hiddenFieldIds: ["text-field"],
    wrapText: false,
    columnWidths: { "text-field": 1000 },
  };
  await act(async () => {
    await seedView("inventory", external);
    client.setQueryData(["inventories", "inventory", "items"], []);
  });
  await act(async () => {
    await i18n.changeLanguage("de");
  });
  expect(ids()).toEqual(["second", "first"]);
  expect(title).toHaveValue("ZZZ");
  expect(heading).toHaveAttribute("aria-sort", "descending");
  expect(widths()).toEqual(before);
  expect(screen.getByRole("status")).toHaveTextContent("2 von 3 Einträgen");
  expect(savedView("inventory")!).toMatchObject(external);
  // Restore the simulated remote result before leaving; only presentation changes are deferred.
  act(() =>
    client.setQueryData(["inventories", "inventory", "items"], serverItems),
  );
  await user.click(screen.getByRole("button", { name: "Abbrechen" }));
  expect(
    screen.queryByRole("columnheader", { name: "Title" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("0 von 3 Einträgen");
  expect(updateInventoryItems).not.toHaveBeenCalled();
});

// Test saved values are re-evaluated by the original search only after the atomic write completes.
test("reapplies search after saving a row that no longer matches", async () => {
  const user = userEvent.setup();
  renderTable();
  await user.type(screen.getByRole("searchbox"), "First");
  await start(user);
  const title = within(row()).getByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "Renamed");
  expect(row()).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("1 of 2 items");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("No matching items.")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("0 of 2 items");
  expect(vi.mocked(updateInventoryItems).mock.calls[0][1].items).toHaveLength(
    1,
  );
});

// Test icon-only row actions retain their names, row descriptions and localized hover help.
test("provides translated names and tooltips for compact row actions", async () => {
  renderTable();
  for (const [locale, edit, remove] of [
    ["en", "Edit", "Delete"],
    ["de", "Bearbeiten", "Löschen"],
  ]) {
    await act(async () => {
      await i18n.changeLanguage(locale);
    });
    for (const name of [edit, remove]) {
      for (const button of screen.getAllByRole("button", { name })) {
        expect(button).toHaveAttribute("title", name);
        expect(button).toHaveAttribute("aria-describedby");
        expect(button.textContent?.trim()).toBe("");
        expect(button.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      }
    }
  }
});

// Test the independent action pane follows source row growth and shrinking while cells are edited.
test("keeps action rows aligned as edited cell contents and errors change row height", async () => {
  const subscriptions: {
    targets: Set<Element>;
    callback: ResizeObserverCallback;
    observer: ResizeObserver;
  }[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      targets = new Set<Element>();
      constructor(callback: ResizeObserverCallback) {
        subscriptions.push({ targets: this.targets, callback, observer: this });
      }
      observe(target: Element) {
        this.targets.add(target);
      }
      unobserve(target: Element) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 0),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const heights: Record<string, number> = { first: 84, second: 52 };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        x: 0,
        y: 0,
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        width: 0,
        height:
          this.tagName === "THEAD"
            ? 41
            : (heights[this.dataset.itemId ?? ""] ?? 0),
        toJSON: () => ({}),
      };
    },
  );
  const user = userEvent.setup();
  renderTable();
  await start(user);
  function resizeRows() {
    act(() => {
      for (const subscription of subscriptions)
        if (
          Array.from(subscription.targets).some(
            (target) => target instanceof HTMLElement && target.dataset.itemId,
          )
        )
          subscription.callback([], subscription.observer);
    });
  }
  resizeRows();
  const actions = screen.getByRole("table", { name: "Actions" });
  const actionRows = actions.querySelectorAll("tbody tr");
  expect(actionRows[0]).toHaveStyle({ height: "84px" });
  expect(actionRows[1]).toHaveStyle({ height: "52px" });
  const title = within(row("second")).getByRole("textbox", { name: "Title" });
  await user.clear(title);
  heights.first = 52;
  heights.second = 108;
  resizeRows();
  expect(actionRows[0]).toHaveStyle({ height: "52px" });
  expect(actionRows[1]).toHaveStyle({ height: "108px" });
  expect(row("second").style.height).toBe("");
});

// Test typed edits save once, omit read-only IDs and retain hidden structured and legacy values.
test("saves changed cells atomically and preserves hidden values, original versions and IDs", async () => {
  await seedView("inventory", {
    version: 1,
    hiddenFieldIds: ["url-field", "datetime-field"],
    columnWidths: { "text-field": 90 },
  });
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
  expect(savedView("inventory")!.columnWidths).toEqual({
    "text-field": 90,
  });
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
  await seedView("inventory", { version: 1, hiddenFieldIds: ["hidden"] });
  const user = userEvent.setup();
  renderTable([...fields, hidden]);
  await start(user);
  const title = within(row()).getByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "Changed");
  await user.click(screen.getByRole("button", { name: "Show Hidden" }));
  expect(savedView("inventory")!.hiddenFieldIds).toEqual(["hidden"]);
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

test("cycles column sorting in the editor and disables row movement until sorting is cleared", async () => {
  const user = userEvent.setup();
  renderTable();
  await start(user);
  const ids = () =>
    Array.from(document.querySelectorAll<HTMLElement>("tr[data-item-id]")).map(
      (row) => row.dataset.itemId,
    );
  const handle = within(row()).getByRole("button", { name: "Move row" });
  await act(async () => handle.focus());
  expect(screen.getByRole("tooltip")).toHaveTextContent("Drag to move");
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  expect(ids()).toEqual(["second", "first"]);
  const heading = screen.getByRole("button", { name: "Title" });
  await user.click(heading);
  expect(ids()).toEqual(["first", "second"]);
  expect(handle).toHaveAttribute("aria-disabled", "true");
  await act(async () => handle.focus());
  expect(
    document.getElementById(handle.getAttribute("aria-describedby")!)!,
  ).toHaveTextContent(
    "Moving rows is only possible without active column sorting.",
  );
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  await user.click(heading);
  await user.click(heading);
  expect(ids()).toEqual(["second", "first"]);
  expect(handle).toHaveAttribute("aria-disabled", "false");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateInventoryItems).toHaveBeenCalledWith("inventory", {
      expected_configuration_revision: 7,
      items: [],
      order: [
        { item_id: "second", expected_revision: 3 },
        { item_id: "first", expected_revision: 1 },
      ],
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Edit table" })).toBeEnabled(),
  );
  expect(ids()).toEqual(["second", "first"]);
});

test("dragging changes only the local order and cancel restores the baseline", async () => {
  const user = userEvent.setup();
  renderTable();
  await start(user);
  const transfer = rowTransfer();
  fireEvent.dragStart(within(row()).getByRole("button", { name: "Move row" }), {
    dataTransfer: transfer,
  });
  hoverRow("second", transfer);
  fireEvent.drop(row("second"), { dataTransfer: transfer });
  expect(
    Array.from(document.querySelectorAll<HTMLElement>("tr[data-item-id]")).map(
      (row) => row.dataset.itemId,
    ),
  ).toEqual(["second", "first"]);
  expect(updateInventoryItems).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(
    Array.from(document.querySelectorAll<HTMLElement>("tr[data-item-id]")).map(
      (row) => row.dataset.itemId,
    ),
  ).toEqual(["first", "second"]);
  expect(updateInventoryItems).not.toHaveBeenCalled();
});

test("reorders visible slots without moving rows excluded by search", async () => {
  serverItems.push({ ...structuredClone(original), id: "third" });
  const user = userEvent.setup();
  renderTable();
  await user.type(screen.getByRole("searchbox"), "First");
  await start(user);
  fireEvent.keyDown(within(row()).getByRole("button", { name: "Move row" }), {
    key: "ArrowDown",
  });
  expect(
    Array.from(document.querySelectorAll<HTMLElement>("tr[data-item-id]")).map(
      (row) => row.dataset.itemId,
    ),
  ).toEqual(["third", "first"]);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateInventoryItems).toHaveBeenCalledWith("inventory", {
      expected_configuration_revision: 7,
      items: [],
      order: [
        { item_id: "third", expected_revision: 1 },
        { item_id: "second", expected_revision: 3 },
        { item_id: "first", expected_revision: 1 },
      ],
    }),
  );
});

/** Model a native drag payload owned by this table editor. */
function rowTransfer() {
  const data = new Map<string, string>();
  return {
    types: [] as string[],
    setData(type: string, value: string) {
      this.types.push(type);
      data.set(type, value);
    },
    getData: (type: string) => data.get(type) ?? "",
    setDragImage: vi.fn(),
    effectAllowed: "",
    dropEffect: "",
  };
}

test("previews row movement with the field editor's opacity, insertion marker and whole-row drag image", async () => {
  const user = userEvent.setup();
  renderTable();
  await start(user);
  const transfer = rowTransfer();
  const ids = () =>
    Array.from(document.querySelectorAll<HTMLElement>("tr[data-item-id]")).map(
      (row) => row.dataset.itemId,
    );
  const startEvent = createEvent.dragStart(
    within(row()).getByRole("button", { name: "Move row" }),
    { dataTransfer: transfer },
  );
  Object.defineProperties(startEvent, {
    clientX: { value: 8 },
    clientY: { value: 12 },
  });
  fireEvent(
    within(row()).getByRole("button", { name: "Move row" }),
    startEvent,
  );
  expect(transfer.setDragImage).toHaveBeenCalledWith(row(), 8, 12);
  expect(row()).toHaveClass("opacity-50");
  hoverRow("second", transfer);
  expect(ids()).toEqual(["second", "first"]);
  expect(row("second")).toHaveClass("[&>td]:after:opacity-100");
  expect(updateInventoryItems).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(ids()).toEqual(["first", "second"]);
  expect(row()).not.toHaveClass("opacity-50");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  // A canceled drag end has the same effect; dropping onto the moved source keeps the preview slot.
  fireEvent.dragStart(within(row()).getByRole("button", { name: "Move row" }), {
    dataTransfer: transfer,
  });
  hoverRow("second", transfer);
  fireEvent.drop(row(), { dataTransfer: transfer });
  fireEvent.dragEnd(row());
  expect(ids()).toEqual(["second", "first"]);
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

/** Supply explicit insertion coordinates when jsdom lacks native DragEvent support. */
function hoverRow(
  id: string,
  transfer: ReturnType<typeof rowTransfer>,
  side: "before" | "after" = "after",
) {
  const target = row(id);
  const bounds = target.getBoundingClientRect();
  const event = createEvent.dragOver(target, { dataTransfer: transfer });
  Object.defineProperty(event, "clientY", {
    value: bounds.top + bounds.height / 2 + (side === "after" ? 1 : -1),
  });
  fireEvent(target, event);
}

test.each([false, true])(
  "animates data and action rows while respecting reduced motion (%s)",
  async (reduced) => {
    const nativeAnimate = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "animate",
    );
    const cancel = vi.fn();
    const animate = vi.fn(() => ({ cancel, onfinish: null }));
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: reduced })),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.matches("[data-drag-row-id]")) {
          const index = Array.from(this.parentElement!.children).indexOf(this);
          return new DOMRect(0, index * 52, 500, 52);
        }
        return new DOMRect(0, 0, 500, 200);
      },
    );
    try {
      const user = userEvent.setup();
      renderTable();
      await start(user);
      const transfer = rowTransfer();
      fireEvent.dragStart(
        within(row()).getByRole("button", { name: "Move row" }),
        { dataTransfer: transfer },
      );
      hoverRow("second", transfer);
      expect(animate).toHaveBeenCalledTimes(reduced ? 0 : 4);
      if (!reduced)
        expect(animate).toHaveBeenCalledWith(expect.any(Array), {
          duration: 220,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
        });
      fireEvent.dragEnd(row());
      if (!reduced) expect(cancel).toHaveBeenCalled();
      expect(
        Array.from(
          document.querySelectorAll<HTMLElement>("tr[data-item-id]"),
        ).map((row) => row.dataset.itemId),
      ).toEqual(["first", "second"]);
    } finally {
      cleanup();
      if (nativeAnimate)
        Object.defineProperty(Element.prototype, "animate", nativeAnimate);
      else Reflect.deleteProperty(Element.prototype, "animate");
    }
  },
);

/** Find unsaved data rows independently of their mirrored action rows. */
function newRows() {
  return Array.from(
    document.querySelectorAll<HTMLTableRowElement>(
      'tr[data-item-id^="draft-"]',
    ),
  );
}

test("adds and validates multiple inline rows in an empty inventory and saves only retained rows", async () => {
  serverItems = [];
  const user = userEvent.setup();
  renderTable([fields[0], fields.at(-1)!]);
  await user.click(screen.getByRole("button", { name: "Edit table" }));
  await user.click(await screen.findByRole("button", { name: "Add row" }));
  expect(newRows()).toHaveLength(1);
  const title = within(newRows()[0]).getByRole("textbox", { name: "Title" });
  expect(title).toHaveFocus();
  expect(screen.getByText("New")).toBeVisible();
  expect(within(newRows()[0]).queryByText("New")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(updateInventoryItems).not.toHaveBeenCalled();
  await user.type(title, "Inline retained");
  await user.click(screen.getByRole("button", { name: "Add row" }));
  expect(newRows()).toHaveLength(2);
  expect(
    within(newRows()[1]).getByRole("textbox", { name: "Title" }),
  ).toHaveFocus();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.click(
    screen.getAllByRole("button", { name: "Remove new row" })[1],
  );
  expect(newRows()).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateInventoryItems).toHaveBeenCalledWith("inventory", {
      expected_configuration_revision: 7,
      items: [],
      new_items: [
        { values: [{ field_id: "text-field", value: "Inline retained" }] },
      ],
    }),
  );
  await waitFor(() => expect(newRows()).toHaveLength(0));
  expect(screen.getByText("Inline retained")).toBeVisible();
});

test("keeps new rows below filtered and sorted rows, and cancels their inputs together with cell changes", async () => {
  const user = userEvent.setup();
  renderTable();
  await user.type(screen.getByRole("searchbox"), "First");
  await start(user);
  const heading = screen.getByRole("button", { name: "Title" });
  await user.click(heading);
  await user.click(screen.getByRole("button", { name: "Add row" }));
  await user.type(
    within(newRows()[0]).getByRole("textbox", { name: "Title" }),
    "Does not match search",
  );
  await user.click(heading);
  const ids = () =>
    Array.from(document.querySelectorAll<HTMLElement>("tr[data-item-id]")).map(
      (row) => row.dataset.itemId,
    );
  expect(ids()).toEqual(["first", newRows()[0].dataset.itemId]);
  expect(
    within(newRows()[0]).getByRole("button", { name: "Move row" }),
  ).toHaveAttribute("aria-disabled", "true");
  await user.type(
    within(row()).getByRole("textbox", { name: "Title" }),
    " edited",
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(newRows()).toHaveLength(0);
  expect(screen.getByText("First")).toBeVisible();
  expect(screen.queryByText("Does not match search")).not.toBeInTheDocument();
  expect(updateInventoryItems).not.toHaveBeenCalled();
});

test("preserves inline inputs after a failed save and retries only on explicit request", async () => {
  const user = userEvent.setup();
  renderTable([fields[0]]);
  await start(user);
  await user.click(screen.getByRole("button", { name: "Add row" }));
  await user.type(
    within(newRows()[0]).getByRole("textbox", { name: "Title" }),
    "Retry row",
  );
  vi.mocked(updateInventoryItems).mockRejectedValueOnce(
    new Error("Storage failure"),
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(
      screen.getByText(
        "No changes were saved. Your draft is preserved; try saving again.",
      ),
    ).toBeVisible(),
  );
  expect(
    within(newRows()[0]).getByRole("textbox", { name: "Title" }),
  ).toHaveValue("Retry row");
  expect(updateInventoryItems).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(newRows()).toHaveLength(0));
  expect(updateInventoryItems).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Retry row")).toBeVisible();
});

test("moves new rows between existing entries and saves their chosen positions", async () => {
  const user = userEvent.setup();
  renderTable([fields[0]]);
  await start(user);
  await user.click(screen.getByRole("button", { name: "Add row" }));
  const addedRow = newRows()[0];
  const addedId = addedRow.dataset.itemId!;
  expect(within(addedRow).queryByText("New")).not.toBeInTheDocument();
  const actions = document.querySelector<HTMLElement>(
    `[data-drag-row-id="actions:${addedId}"]`,
  )!;
  expect(within(actions).getByText("New")).toBeVisible();
  expect(
    within(actions).getByRole("button", { name: "Remove new row" }),
  ).toBeEnabled();
  const handle = within(addedRow).getByRole("button", { name: "Move row" });
  expect(handle).toHaveAttribute("aria-disabled", "false");
  await user.type(
    within(addedRow).getByRole("textbox", { name: "Title" }),
    "Inserted",
  );
  const transfer = rowTransfer();
  fireEvent.dragStart(handle, { dataTransfer: transfer });
  hoverRow("first", transfer, "before");
  fireEvent.drop(row("first"), { dataTransfer: transfer });
  const ids = () =>
    Array.from(document.querySelectorAll<HTMLElement>("tr[data-item-id]")).map(
      (row) => row.dataset.itemId,
    );
  expect(ids()).toEqual([addedId, "first", "second"]);
  await user.click(screen.getByRole("button", { name: "Title" }));
  expect(handle).toHaveAttribute("aria-disabled", "true");
  await user.click(screen.getByRole("button", { name: "Title" }));
  await user.click(screen.getByRole("button", { name: "Title" }));
  expect(ids()).toEqual([addedId, "first", "second"]);
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  expect(ids()).toEqual(["first", addedId, "second"]);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateInventoryItems).toHaveBeenCalledWith("inventory", {
      expected_configuration_revision: 7,
      items: [],
      new_items: [{ values: [{ field_id: "text-field", value: "Inserted" }] }],
      order: [
        { item_id: "first", expected_revision: 1 },
        { new_item_index: 0 },
        { item_id: "second", expected_revision: 3 },
      ],
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Edit table" })).toBeEnabled(),
  );
  expect(ids()).toEqual(["first", "created-0", "second"]);
});
