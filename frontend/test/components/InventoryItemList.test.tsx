import { seedView, savedView, preferenceApi } from "../helpers/preferences";
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
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "../../src/services/api";
import {
  deleteInventoryItem,
  updateInventoryItem,
  getInventoryItems,
} from "../../src/services/inventoryItems";
import type { InventoryField } from "../../src/types/inventoryField";
import type { InventoryItem } from "../../src/types/inventoryItem";
import { InventoryItemList } from "../../src/components/InventoryItemList";
import { chooseOptions } from "../helpers/choices";
import { useInventoryItems } from "../../src/hooks/useInventoryItems";

vi.mock("../../src/services/inventoryItems", () => ({
  createInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
  getInventoryItems: vi.fn(),
  updateInventoryItem: vi.fn(),
}));

const mockedDeleteInventoryItem = vi.mocked(deleteInventoryItem);
const mockedUpdateInventoryItem = vi.mocked(updateInventoryItem);
const mockedGetInventoryItems = vi.mocked(getInventoryItems);
const timestamp = "2026-09-24T10:00:00Z";

const fields: InventoryField[] = [
  {
    id: "title-field",
    inventory_id: "inventory-1",
    name: "Title",
    field_type: "text",
    max_length: 120,
    is_required: false,
    is_sortable: true,
    options: [],
    position: 0,
    created_at: timestamp,
    updated_at: timestamp,
  },
  {
    id: "genre-field",
    inventory_id: "inventory-1",
    name: "Genre",
    field_type: "multiselect",
    max_length: null,
    is_required: false,
    is_sortable: true,
    options: [
      {
        id: "genre-rpg",
        field_id: "genre-field",
        name: "RPG",
        position: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    position: 1,
    created_at: timestamp,
    updated_at: timestamp,
  },
  {
    id: "played-field",
    inventory_id: "inventory-1",
    name: "Played",
    field_type: "boolean",
    max_length: null,
    is_required: false,
    is_sortable: true,
    options: [],
    position: 2,
    created_at: timestamp,
    updated_at: timestamp,
  },
];

const items: InventoryItem[] = [
  {
    revision: 1,
    id: "item-1",
    inventory_id: "inventory-1",
    values: [
      {
        id: "value-1",
        field_id: "title-field",
        value: "Baldur's Gate 3",
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: "value-2",
        field_id: "genre-field",
        value: ["genre-rpg"],
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: "value-3",
        field_id: "played-field",
        value: true,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    created_at: timestamp,
    updated_at: timestamp,
  },
];

/** Render the item table with an isolated query client. */
function renderInventoryItemList(
  testItems = items,
  testFields = fields,
  inventoryId = "inventory-1",
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <InventoryItemList
        inventoryId={inventoryId}
        fields={testFields}
        items={testItems}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Test applied filters combine with search and still use hidden column values.
test("combines applied filters with search and resets filters independently", async () => {
  const user = userEvent.setup();
  const otherGate = {
    ...items[0],
    id: "gate-2",
    values: [{ ...items[0].values[0], value: "Another Gate" }],
  };
  const otherRpg = {
    ...items[0],
    id: "other-rpg",
    values: items[0].values.map((value) =>
      value.field_id === "title-field"
        ? { ...value, value: "Other RPG" }
        : value,
    ),
  };
  renderInventoryItemList([...items, otherGate, otherRpg]);
  fireEvent.contextMenu(screen.getByRole("columnheader", { name: "Genre" }));
  await user.click(screen.getByRole("menuitem", { name: "Hide column" }));
  const columns = screen.getAllByRole("table")[0].querySelectorAll("col");
  const widths = Array.from(columns).map((column) => column.style.width);
  await user.type(screen.getByRole("searchbox"), "gate");
  expect(screen.getByRole("status")).toHaveTextContent("2 of 3 items");
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.click(screen.getByRole("button", { name: "Add filter" }));
  await chooseOptions(user, "Column", ["Genre"]);
  await chooseOptions(user, "Options", ["RPG"]);
  expect(screen.getByRole("status")).toHaveTextContent("2 of 3 items");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(screen.getByRole("status")).toHaveTextContent("1 of 3 items");
  expect(screen.getByText("Baldur's Gate 3")).toBeVisible();
  expect(screen.queryByText("Another Gate")).not.toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
  expect(Array.from(columns).map((column) => column.style.width)).toEqual(
    widths,
  );
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.getByRole("searchbox")).toHaveValue("gate");
  expect(screen.getByRole("status")).toHaveTextContent("2 of 3 items");
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByRole("status")).toHaveTextContent("3 items");
  expect(mockedUpdateInventoryItem).not.toHaveBeenCalled();
});

// Test definitions removed by a background refresh cannot leave invisible stale filters active.
test("ignores an applied condition when its column is deleted", async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <InventoryItemList
        inventoryId="inventory-1"
        items={items}
        fields={fields}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.click(screen.getByRole("button", { name: "Add filter" }));
  await chooseOptions(user, "Column", ["Played"]);
  await chooseOptions(user, "Condition", ["is No"]);
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(screen.getByText("No matching items.")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("0 of 1 items");
  view.rerender(
    <QueryClientProvider client={client}>
      <InventoryItemList
        inventoryId="inventory-1"
        items={items}
        fields={fields.filter((field) => field.id !== "played-field")}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Baldur's Gate 3")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("1 item");
  expect(screen.queryByLabelText("1 active filter")).not.toBeInTheDocument();
});

// Test search filters both panes before sorting without changing automatic base widths.
test("searches before sorting, keeps widths stable, and restores all rows when cleared", async () => {
  const user = userEvent.setup();
  const another = {
    ...items[0],
    id: "item-2",
    values: [{ ...items[0].values[0], value: "Gate Alpha" }],
  };
  const excluded = {
    ...items[0],
    id: "item-3",
    values: [
      {
        ...items[0].values[0],
        value:
          "A very long title that must still determine the automatic width",
      },
    ],
  };
  renderInventoryItemList([...items, another, excluded]);
  const table = screen.getAllByRole("table")[0];
  const widths = () =>
    Array.from(table.querySelectorAll("col")).map((col) => col.style.width);
  const initialWidths = widths();
  await user.click(
    within(screen.getByRole("columnheader", { name: "Title" })).getByRole(
      "button",
      { name: "Title" },
    ),
  );
  await user.type(
    screen.getByRole("searchbox", { name: "Search inventory items" }),
    "GATE",
  );
  expect(screen.getByRole("status")).toHaveTextContent("2 of 3 items");
  expect(screen.queryByText(excluded.values[0].value)).not.toBeInTheDocument();
  expect(within(table).getAllByRole("row")[1]).toHaveTextContent(
    "Baldur's Gate 3",
  );
  expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
  expect(widths()).toEqual(initialWidths);
  await user.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByRole("searchbox")).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("3 items");
  expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(3);
  expect(mockedUpdateInventoryItem).not.toHaveBeenCalled();
  expect(mockedDeleteInventoryItem).not.toHaveBeenCalled();
});

// Test hiding a field does not remove it from the inventory-wide search scope.
test("finds selection labels in hidden columns", async () => {
  const user = userEvent.setup();
  renderInventoryItemList();
  fireEvent.contextMenu(screen.getByRole("columnheader", { name: "Genre" }));
  await user.click(screen.getByRole("menuitem", { name: "Hide column" }));
  await user.type(screen.getByRole("searchbox"), "rpg");
  expect(
    screen.queryByRole("columnheader", { name: "Genre" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Baldur's Gate 3")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("1 of 1 items");
});

// Test no matches differs from a genuinely empty inventory and clears both table panes.
test("shows a distinct no-results state and keeps search available in empty inventories", async () => {
  const user = userEvent.setup();
  const view = renderInventoryItemList();
  await user.type(screen.getByRole("searchbox"), "missing");
  expect(screen.getByText("No matching items.")).toBeVisible();
  expect(screen.queryByText("No items yet.")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Edit" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("0 of 1 items");
  view.unmount();
  renderInventoryItemList([]);
  expect(screen.getByText("No items yet.")).toBeVisible();
  expect(screen.getByRole("searchbox")).toBeEnabled();
});

// Test background refreshes cannot replace an open draft's concurrency precondition.
test("preserves a stale edit until the user explicitly discards inputs and reloads", async () => {
  const user = userEvent.setup();
  const item = { ...items[0], values: [items[0].values[0]] };
  const remote = {
    ...item,
    revision: 2,
    values: [{ ...item.values[0], value: "Other tab" }],
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <InventoryItemList
        inventoryId="inventory-1"
        fields={[fields[0]]}
        items={[item]}
      />
    </QueryClientProvider>,
  );
  mockedUpdateInventoryItem.mockRejectedValueOnce(
    new ApiError(409, "Conflict", "inventory_item_conflict"),
  );
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const input = screen.getByRole("textbox", { name: /Title/ });
  await user.clear(input);
  await user.type(input, "Local draft");
  view.rerender(
    <QueryClientProvider client={client}>
      <InventoryItemList
        inventoryId="inventory-1"
        fields={[fields[0]]}
        items={[remote]}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your inputs are preserved",
    ),
  );
  expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
    "inventory-1",
    "item-1",
    {
      expected_revision: 1,
      values: [{ field_id: fields[0].id, value: "Local draft" }],
    },
  );
  expect(input).toHaveValue("Local draft");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  mockedGetInventoryItems.mockRejectedValueOnce(new Error("Offline"));
  await user.click(
    screen.getByRole("button", { name: "Discard inputs and reload" }),
  );
  await screen.findByText(
    "The current version could not be loaded. Please try again.",
  );
  expect(input).toHaveValue("Local draft");
  mockedGetInventoryItems.mockResolvedValueOnce([remote]);
  await user.click(
    screen.getByRole("button", { name: "Discard inputs and reload" }),
  );
  await waitFor(() => expect(input).toHaveValue("Other tab"));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  mockedUpdateInventoryItem.mockResolvedValueOnce({ ...remote, revision: 3 });
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedUpdateInventoryItem).toHaveBeenLastCalledWith(
      "inventory-1",
      "item-1",
      {
        expected_revision: 2,
        values: [{ field_id: fields[0].id, value: "Other tab" }],
      },
    ),
  );
});

// Test deletion by another client never closes or clears the user's unsaved edit draft.
test("keeps draft inputs when the conflicting item no longer exists", async () => {
  const user = userEvent.setup();
  mockedUpdateInventoryItem.mockRejectedValueOnce(
    new ApiError(404, "Missing", "inventory_item_not_found"),
  );
  mockedGetInventoryItems.mockResolvedValueOnce([]);
  renderInventoryItemList([items[0]], [fields[0]]);
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const input = screen.getByRole("textbox", { name: /Title/ });
  await user.clear(input);
  await user.type(input, "Keep this draft");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText(/Your inputs are preserved/);
  await user.click(
    screen.getByRole("button", { name: "Discard inputs and reload" }),
  );
  await screen.findByText(/This item no longer exists/);
  expect(input).toHaveValue("Keep this draft");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
});

// Test stale checkbox writes are never retried automatically and use the refreshed revision after recovery.
test("requires reloading after a checkbox conflict before another toggle", async () => {
  const user = userEvent.setup();
  const item = { ...items[0], values: [] };
  const remote = { ...item, revision: 2 };
  mockedGetInventoryItems
    .mockResolvedValueOnce([item])
    .mockResolvedValue([remote]);
  mockedUpdateInventoryItem.mockRejectedValueOnce(
    new ApiError(409, "Conflict", "inventory_item_conflict"),
  );
  mockedUpdateInventoryItem.mockResolvedValueOnce({ ...remote, revision: 3 });
  // Render real query subscriptions so reloads exercise the table's refreshed data rather than static props.
  function LiveTable() {
    const query = useInventoryItems("inventory-1");
    return (
      <InventoryItemList
        inventoryId="inventory-1"
        fields={[{ ...fields[2], name: "Checked", field_type: "checkbox" }]}
        items={query.data ?? []}
      />
    );
  }
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <LiveTable />
    </QueryClientProvider>,
  );
  const checkbox = await screen.findByRole("checkbox", {
    name: "Toggle Checked",
  });
  await user.click(checkbox);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The checkbox change was not saved",
    ),
  );
  expect(checkbox).not.toBeChecked();
  expect(checkbox).toBeDisabled();
  expect(mockedUpdateInventoryItem).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Reload list" }));
  await waitFor(() => expect(checkbox).toBeEnabled());
  await user.click(checkbox);
  await waitFor(() =>
    expect(mockedUpdateInventoryItem).toHaveBeenLastCalledWith(
      "inventory-1",
      "item-1",
      {
        expected_revision: 2,
        values: [{ field_id: fields[2].id, value: true }],
      },
    ),
  );
});

// Test a stale delete must be explicitly refreshed and confirmed again against its current revision.
test("requires a fresh confirmation after a deletion conflict", async () => {
  const user = userEvent.setup();
  mockedDeleteInventoryItem.mockRejectedValueOnce(
    new ApiError(409, "Conflict", "inventory_item_conflict"),
  );
  mockedDeleteInventoryItem.mockResolvedValueOnce(undefined);
  mockedGetInventoryItems.mockResolvedValueOnce([{ ...items[0], revision: 2 }]);
  renderInventoryItemList([items[0]], [fields[0]]);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Load the current version",
    ),
  );
  expect(within(dialog).getByRole("button", { name: "Delete" })).toBeDisabled();
  await user.click(
    within(dialog).getByRole("button", { name: "Load current item" }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Delete" }),
    ).toBeEnabled(),
  );
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(mockedDeleteInventoryItem).toHaveBeenLastCalledWith(
      "inventory-1",
      "item-1",
      2,
    ),
  );
});

// Test direct toggles use full replacement and do not open a dialog or coerce neighboring values.
test.each([true, false, undefined])(
  "toggles a table checkbox with stored state %s",
  async (stored) => {
    const user = userEvent.setup();
    const checkbox = {
      ...fields[2],
      name: "Checked",
      field_type: "checkbox" as const,
    };
    const item = {
      ...items[0],
      values: items[0].values.filter((value) => value.field_id !== checkbox.id),
    };
    if (stored !== undefined)
      item.values.push({ ...items[0].values[2], value: stored });
    mockedUpdateInventoryItem.mockResolvedValueOnce(item);
    renderInventoryItemList([item], [fields[0], fields[1], checkbox]);
    const input = screen.getByRole("checkbox", { name: "Toggle Checked" });
    expect(input).toHaveProperty("checked", stored === true);
    await user.click(input);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
        "inventory-1",
        "item-1",
        {
          expected_revision: 1,
          values: [
            { field_id: fields[0].id, value: items[0].values[0].value },
            { field_id: fields[1].id, value: items[0].values[1].value },
            { field_id: checkbox.id, value: stored !== true },
          ],
        },
      ),
    );
  },
);

// Test pending feedback and locking prevent stale concurrent full replacements from multiple clicks.
test("locks table actions while a checkbox update is pending", async () => {
  const user = userEvent.setup();
  let finish!: (item: InventoryItem) => void;
  mockedUpdateInventoryItem.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  renderInventoryItemList(
    [{ ...items[0], values: [] }],
    [{ ...fields[2], name: "Checked", field_type: "checkbox" }],
  );
  const input = screen.getByRole("checkbox", { name: "Toggle Checked" });
  await user.click(input);
  await waitFor(() => expect(input).toBeDisabled());
  expect(input).toBeChecked();
  expect(input).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  await user.click(input);
  expect(mockedUpdateInventoryItem).toHaveBeenCalledTimes(1);
  await act(async () => finish(items[0]));
  await waitFor(() => expect(input).toBeEnabled());
});

// Test failed persistence restores the original state, displays an error, and permits a retry.
test("rolls back a failed checkbox preview and allows retrying", async () => {
  const user = userEvent.setup();
  mockedUpdateInventoryItem.mockRejectedValueOnce(
    new Error("Synthetic failure"),
  );
  mockedUpdateInventoryItem.mockResolvedValueOnce(items[0]);
  renderInventoryItemList(
    [{ ...items[0], values: [] }],
    [{ ...fields[2], name: "Checked", field_type: "checkbox" }],
  );
  const input = screen.getByRole("checkbox", { name: "Toggle Checked" });
  await user.click(input);
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to update inventory item.",
    ),
  );
  expect(input).not.toBeChecked();
  expect(input).toBeEnabled();
  await user.click(input);
  await waitFor(() =>
    expect(mockedUpdateInventoryItem).toHaveBeenCalledTimes(2),
  );
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});

// Test old incomplete items route into a local edit draft instead of bypassing newly required values.
test("opens the edit dialog for missing requirements before saving a checkbox change", async () => {
  const user = userEvent.setup();
  mockedUpdateInventoryItem.mockResolvedValueOnce(items[0]);
  const checkbox = {
    ...fields[2],
    name: "Checked",
    field_type: "checkbox" as const,
  };
  renderInventoryItemList(
    [{ ...items[0], values: [] }],
    [{ ...fields[0], is_required: true }, checkbox],
  );
  await user.click(screen.getByRole("checkbox", { name: "Toggle Checked" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("status")).toHaveTextContent(
    "has not been saved yet",
  );
  expect(
    within(dialog).getByRole("checkbox", { name: "Checked" }),
  ).toBeChecked();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(mockedUpdateInventoryItem).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(
    screen.getByRole("checkbox", { name: "Toggle Checked" }),
  ).not.toBeChecked();
  await user.click(screen.getByRole("checkbox", { name: "Toggle Checked" }));
  await user.type(screen.getByRole("textbox", { name: /Title/ }), "Complete");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
      "inventory-1",
      "item-1",
      {
        expected_revision: 1,
        values: [
          { field_id: fields[0].id, value: "Complete" },
          { field_id: checkbox.id, value: true },
        ],
      },
    ),
  );
});

// Test safe links use display text or their address and open without granting access to the opener.
test.each([
  [
    { url: "https://example.com/docs", label: "Documentation" },
    "Documentation",
  ],
  [{ url: "https://example.com/docs" }, "https://example.com/docs"],
  [
    { url: "https://example.com/docs", label: "   " },
    "https://example.com/docs",
  ],
  [
    { url: "https://example.com/docs", label: "<img src=x onerror=alert(1)>" },
    "<img src=x onerror=alert(1)>",
  ],
])("renders a safe URL value %j", (value, name) => {
  renderInventoryItemList(
    [{ ...items[0], values: [{ ...items[0].values[0], value }] }],
    [{ ...fields[0], name: "Website", field_type: "url" }],
  );
  const link = screen.getByRole("link", { name });
  expect(link).toHaveAttribute("href", value.url);
  expect(link).toHaveAttribute("target", "_blank");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(link).toHaveAttribute("title", value.url);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

// Test malformed or legacy data cannot introduce an executable link into the table.
test.each([
  { url: "javascript:alert(1)", label: "Unsafe" },
  { url: "data:text/html,test" },
  { url: "https://example.com\n" },
  null,
  "https://example.com",
  { url: 42 },
])("never links unsupported stored URL data %j", (value) => {
  renderInventoryItemList(
    [{ ...items[0], values: [{ ...items[0].values[0], value }] }],
    [{ ...fields[0], name: "Website", field_type: "url" }],
  );
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

// Test editing restores structured data, while explicit clearing follows full replacement semantics.
test.each([false, true])(
  "edits URL values with explicit clearing: %s",
  async (clear) => {
    const user = userEvent.setup();
    const urlField = {
      ...fields[0],
      name: "Website",
      field_type: "url" as const,
    };
    const value = { url: "https://example.com/docs", label: "Documentation" };
    const item = { ...items[0], values: [{ ...items[0].values[0], value }] };
    mockedUpdateInventoryItem.mockResolvedValue(item);
    renderInventoryItemList([item], [urlField]);
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const address = screen.getByLabelText("Website: Web address");
    const label = screen.getByLabelText("Website: Link text (optional)");
    expect(address).toHaveValue(value.url);
    expect(label).toHaveValue(value.label);
    await user.clear(label);
    await user.clear(address);
    if (!clear) await user.type(address, "https://example.org/help");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
        "inventory-1",
        "item-1",
        {
          expected_revision: 1,
          values: clear
            ? []
            : [
                {
                  field_id: urlField.id,
                  value: { url: "https://example.org/help" },
                },
              ],
        },
      ),
    );
  },
);

// Test newly required links keep old entries readable but must be supplied when editing them.
test("requires an address when editing an old item missing a required URL", async () => {
  const user = userEvent.setup();
  renderInventoryItemList(
    [{ ...items[0], values: [] }],
    [{ ...fields[0], name: "Website", field_type: "url", is_required: true }],
  );
  expect(screen.getByRole("cell", { name: "—" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.type(
    screen.getByLabelText("Website: Web address"),
    "https://example.com",
  );
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

// Test table display and read-only editing retain the server-owned ID outside replacement payloads.
test("shows automatic numbers and never submits them while editing an item", async () => {
  const user = userEvent.setup();
  const automatic = {
    ...fields[0],
    name: "Reference",
    field_type: "id" as const,
  };
  const item = { ...items[0], values: [{ ...items[0].values[0], value: 42 }] };
  mockedUpdateInventoryItem.mockResolvedValue(item);
  renderInventoryItemList([item], [automatic]);
  expect(screen.getByRole("cell", { name: "42" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = screen.getByRole("dialog", { name: "Edit inventory item" });
  const input = within(dialog).getByRole("textbox", { name: "Reference" });
  expect(input).toHaveValue("42");
  expect(input).toHaveAttribute("readonly");
  await user.type(input, "99");
  expect(input).toHaveValue("42");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
      "inventory-1",
      "item-1",
      { expected_revision: 1, values: [] },
    ),
  );
});

// Test readable table durations and complete replacement after changing elapsed hours.
test("formats durations and edits their stored seconds without wrapping hours", async () => {
  const user = userEvent.setup();
  mockedUpdateInventoryItem.mockResolvedValue(items[0]);
  const duration = {
    ...fields[0],
    name: "Usage time",
    field_type: "duration" as const,
  };
  renderInventoryItemList(
    [{ ...items[0], values: [{ ...items[0].values[0], value: 94530 }] }],
    [duration],
  );
  expect(screen.getByText("26 h 15 min 30 s")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("spinbutton", { name: "Hours" })).toHaveValue("26");
  await user.clear(screen.getByRole("spinbutton", { name: "Hours" }));
  await user.type(screen.getByRole("spinbutton", { name: "Hours" }), "27");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
      "inventory-1",
      "item-1",
      {
        expected_revision: 1,
        values: [{ field_id: duration.id, value: 98130 }],
      },
    ),
  );
});

// Test that old items without a newly required duration remain readable until explicitly edited.
test("requires a missing duration on editing without changing the existing item on read", async () => {
  const user = userEvent.setup();
  mockedUpdateInventoryItem.mockResolvedValue(items[0]);
  const duration = {
    ...fields[0],
    field_type: "duration" as const,
    is_required: true,
  };
  renderInventoryItemList([{ ...items[0], values: [] }], [duration]);
  expect(screen.getByText("—")).toBeVisible();
  expect(mockedUpdateInventoryItem).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.type(screen.getByRole("spinbutton", { name: "Seconds" }), "0");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
      "inventory-1",
      "item-1",
      { expected_revision: 1, values: [{ field_id: duration.id, value: 0 }] },
    ),
  );
});

// Test that editing and clearing an existing optional duration omits it from the replacement.
test("clears a duration only when every component is removed", async () => {
  const user = userEvent.setup();
  mockedUpdateInventoryItem.mockResolvedValue(items[0]);
  const duration = { ...fields[0], field_type: "duration" as const };
  renderInventoryItemList(
    [{ ...items[0], values: [{ ...items[0].values[0], value: 0 }] }],
    [duration],
  );
  expect(screen.getByText("0 s")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  for (const label of ["Hours", "Minutes", "Seconds"])
    await user.clear(screen.getByRole("spinbutton", { name: label }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
      "inventory-1",
      "item-1",
      { expected_revision: 1, values: [] },
    ),
  );
});

// Test legacy selection IDs remain explicit until the user chooses to remove them.
test("allows clearing unavailable saved multi-choice options without keeping their IDs", async () => {
  const user = userEvent.setup();
  mockedUpdateInventoryItem.mockResolvedValue(items[0]);
  const multi = fields[1];
  renderInventoryItemList(
    [
      {
        ...items[0],
        values: [
          {
            ...items[0].values[0],
            field_id: multi.id,
            value: ["removed-option"],
          },
        ],
      },
    ],
    [multi],
  );
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.getByRole("combobox", { name: "Genre" })).toHaveTextContent(
    "Unavailable option",
  );
  await chooseOptions(user, "Genre", ["Unavailable option"]);
  expect(screen.getByRole("combobox", { name: "Genre" })).toHaveTextContent(
    "No selection",
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
      "inventory-1",
      "item-1",
      { expected_revision: 1, values: [] },
    ),
  );
});

// Test that disabling a column also removes an active sort after a field refetch.
test("removes sorting controls and active sorting when a field becomes unsortable", async () => {
  const user = userEvent.setup();
  const client = new QueryClient();
  const second = {
    ...items[0],
    id: "second",
    values: [{ ...items[0].values[0], value: "Animal Crossing" }],
  };
  const testItems = [...items, second];
  const view = render(
    <QueryClientProvider client={client}>
      <InventoryItemList
        inventoryId="inventory-1"
        fields={fields}
        items={testItems}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Title" }));
  expect(
    within(screen.getAllByRole("row")[1]).getByText("Animal Crossing"),
  ).toBeVisible();
  view.rerender(
    <QueryClientProvider client={client}>
      <InventoryItemList
        inventoryId="inventory-1"
        fields={fields.map((field) => ({ ...field, is_sortable: false }))}
        items={testItems}
      />
    </QueryClientProvider>,
  );
  const header = screen.getByRole("columnheader", { name: "Title" });
  expect(within(header).queryByRole("button")).not.toBeInTheDocument();
  expect(header).not.toHaveAttribute("aria-sort");
  expect(header.querySelector("svg")).not.toBeInTheDocument();
  expect(
    within(screen.getAllByRole("row")[1]).getByText("Baldur's Gate 3"),
  ).toBeVisible();
});

// Test variant B: old incomplete items stay visible but cannot be saved without required values.
test("requires missing values only when editing an existing item and preserves explicit no", async () => {
  const user = userEvent.setup();
  mockedUpdateInventoryItem.mockResolvedValue(items[0]);
  renderInventoryItemList(
    [{ ...items[0], values: [] }],
    fields.map((field) => ({ ...field, is_required: true })),
  );
  expect(screen.getAllByText("—")).toHaveLength(3);
  expect(mockedUpdateInventoryItem).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  const save = screen.getByRole("button", { name: "Save changes" });
  expect(save).toBeDisabled();
  expect(screen.getByRole("combobox", { name: /Played/ })).toHaveTextContent(
    "No selection",
  );
  await user.type(screen.getByRole("textbox", { name: /Title/ }), "Cable");
  await chooseOptions(user, "Genre", ["RPG"]);
  await chooseOptions(user, "Played", ["No"]);
  expect(save).toBeEnabled();
  await user.click(save);
  await waitFor(() =>
    expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
      "inventory-1",
      "item-1",
      {
        expected_revision: 1,
        values: [
          { field_id: "title-field", value: "Cable" },
          { field_id: "genre-field", value: ["genre-rpg"] },
          { field_id: "played-field", value: false },
        ],
      },
    ),
  );
});

describe("InventoryItemList", () => {
  // Test cursor-positioned settings enable Auto only for the chosen field and preserve other manual bases.
  test("offers per-column Auto and visibility settings at the cursor", async () => {
    const user = userEvent.setup();
    const key = "inventory-1";
    await seedView(key, {
      version: 1,
      columnWidths: { "title-field": 210, "genre-field": 190 },
    });
    renderInventoryItemList();
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "Title" }), {
      clientX: 31,
      clientY: 42,
    });
    expect(screen.getByRole("menu", { name: "Column Title" })).toHaveStyle({
      left: "31px",
      top: "42px",
    });
    const automatic = screen.getByRole("menuitemcheckbox", {
      name: "Automatic width",
    });
    expect(automatic).not.toBeChecked();
    await user.click(automatic);
    expect(savedView(key)!.columnWidths).toEqual({
      "genre-field": 190,
    });
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "Title" }), {
      clientX: 40,
      clientY: 50,
    });
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Automatic width" }),
    ).toBeChecked();
    await user.keyboard("{Escape}");
    fireEvent.contextMenu(screen.getByRole("columnheader", { name: "Genre" }), {
      clientX: 40,
      clientY: 50,
    });
    await user.click(screen.getByRole("menuitem", { name: "Hide column" }));
    expect(
      screen.queryByRole("columnheader", { name: "Genre" }),
    ).not.toBeInTheDocument();
    expect(savedView(key)!.columnWidths).toEqual({
      "genre-field": 190,
    });
    await user.click(screen.getByRole("button", { name: "View" }));
    const all = screen.getByRole("menuitemcheckbox", {
      name: "Automatic widths",
    });
    expect(all).toBeChecked();
    expect(all).toBeEnabled();
    await user.click(all);
    expect(savedView(key)!.columnWidths).toEqual({});
  });

  // Test keyboard invocation and the last-column visibility guard work in the header context menu.
  test("opens column settings by keyboard and protects the last visible column", async () => {
    const user = userEvent.setup();
    renderInventoryItemList(items, [fields[0]]);
    const title = screen.getByRole("button", { name: "Title" });
    title.focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Automatic width" }),
    ).toBeChecked();
    expect(
      screen.getByRole("menuitem", { name: "Hide column" }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(title).toHaveFocus();
  });

  // Test runtime surplus never writes preferences, including when manual and Auto columns coexist.
  test("keeps window surplus out of persistence and saves only the resized column's base", async () => {
    const user = userEvent.setup();
    const callbacks = new Map<Element, (width: number) => void>();
    vi.stubGlobal(
      "ResizeObserver",
      class implements ResizeObserver {
        callback: ResizeObserverCallback;
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }
        observe(target: Element) {
          callbacks.set(target, (width) =>
            this.callback(
              [{ target, contentRect: { width } } as ResizeObserverEntry],
              this,
            ),
          );
        }
        unobserve(target: Element) {
          callbacks.delete(target);
        }
        disconnect = vi.fn();
      },
    );
    const key = "inventory-1";
    await seedView(key, { version: 1, columnWidths: { "title-field": 180 } });
    const writes = vi.spyOn(preferenceApi, "updateInventoryView");
    renderInventoryItemList();
    const viewport = screen.getByRole("region", { name: "Inventory items" });
    const table = within(viewport).getByRole("table");
    const columns = Array.from(table.querySelectorAll("col"));
    act(() => callbacks.get(viewport)?.(1000));
    const wideAuto = Number.parseFloat(columns[1].style.width);
    expect(columns[0]).toHaveStyle({ width: "180px" });
    act(() => callbacks.get(viewport)?.(600));
    expect(columns[0]).toHaveStyle({ width: "180px" });
    expect(Number.parseFloat(columns[1].style.width)).toBeLessThan(wideAuto);
    act(() => callbacks.get(viewport)?.(200));
    expect(
      Number.parseFloat((table as HTMLTableElement).style.width),
    ).toBeGreaterThan(200);
    act(() => callbacks.get(viewport)?.(1000));
    expect(writes).not.toHaveBeenCalled();
    const handle = screen.getByRole("separator", { name: "Resize Genre" });
    const base = Number(handle.getAttribute("aria-valuenow"));
    expect(wideAuto).toBeGreaterThan(base);
    handle.focus();
    await user.keyboard("{ArrowRight}");
    expect(savedView(key)!.columnWidths).toEqual({
      "title-field": 180,
      "genre-field": base + 16,
    });
    expect(columns[0]).toHaveStyle({ width: "180px" });
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Automatic widths" }),
    ).not.toBeChecked();
  });

  // Test pinned actions are outside the horizontal scroll region and still target their source item.
  test("renders item actions independently of the scrolling data table", async () => {
    const user = userEvent.setup();
    renderInventoryItemList();
    const data = screen.getByRole("region", { name: "Inventory items" });
    const actions = screen.getByRole("table", { name: "Actions" });
    expect(data).not.toContainElement(actions);
    expect(
      within(data).queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
    const edit = within(actions).getByRole("button", { name: "Edit" });
    const sourceId = edit.getAttribute("aria-describedby")!;
    expect(document.getElementById(sourceId)).toHaveTextContent(
      "Baldur's Gate 3",
    );
    await user.click(edit);
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Baldur's Gate 3",
    );
  });

  // Test column resizing persists presentation without sorting or modifying item data.
  test("restores a resized column and resets widths through View", async () => {
    const user = userEvent.setup();
    const first = renderInventoryItemList();
    const handle = screen.getByRole("separator", { name: "Resize Title" });
    const initialWidth = Number(handle.getAttribute("aria-valuenow"));
    handle.focus();
    await user.keyboard("{ArrowRight}");
    expect(handle).toHaveAttribute("aria-valuenow", String(initialWidth + 16));
    expect(
      screen.getByRole("columnheader", { name: "Title" }),
    ).not.toHaveAttribute("aria-sort");
    first.unmount();
    renderInventoryItemList();
    expect(
      screen.getByRole("separator", { name: "Resize Title" }),
    ).toHaveAttribute("aria-valuenow", String(initialWidth + 16));
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Automatic widths" }),
    );
    expect(
      screen.getByRole("separator", { name: "Resize Title" }),
    ).toHaveAttribute("aria-valuenow", String(initialWidth));
    expect(mockedUpdateInventoryItem).not.toHaveBeenCalled();
    expect(mockedDeleteInventoryItem).not.toHaveBeenCalled();
  });

  // Test that hiding columns affects table presentation while edits still submit every field.
  test("hides columns, retains one visible column, and preserves hidden values when editing", async () => {
    const user = userEvent.setup();
    mockedUpdateInventoryItem.mockResolvedValue(items[0]);
    renderInventoryItemList();
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(screen.getByRole("menuitem", { name: "Columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Title" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Played" }));
    expect(
      screen.queryByRole("columnheader", { name: "Title" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Played" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Genre" }),
    ).toBeDisabled();
    expect(
      within(screen.getAllByRole("row")[1]).getAllByRole("cell"),
    ).toHaveLength(1);
    expect(screen.queryByText("Baldur's Gate 3")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue(
      "Baldur's Gate 3",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
        "inventory-1",
        "item-1",
        {
          expected_revision: 1,
          values: [
            { field_id: "title-field", value: "Baldur's Gate 3" },
            { field_id: "genre-field", value: ["genre-rpg"] },
            { field_id: "played-field", value: true },
          ],
        },
      ),
    );
  });

  // Test reopening an inventory restores its saved view and keeps other inventories independent.
  test("restores sorting, hidden columns, and wrapping separately for each inventory", async () => {
    const user = userEvent.setup();
    const another: InventoryItem = {
      ...items[0],
      id: "second",
      values: [{ ...items[0].values[0], value: "Animal Crossing" }],
    };
    const first = renderInventoryItemList([...items, another]);
    await user.click(screen.getByRole("button", { name: "Title" }));
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(screen.getByRole("menuitem", { name: "Columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Genre" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Wrap text" }),
    );
    first.unmount();

    const second = renderInventoryItemList([], fields, "inventory-2");
    expect(screen.getByRole("columnheader", { name: "Genre" })).toBeVisible();
    expect(
      screen.getByRole("columnheader", { name: "Title" }),
    ).not.toHaveAttribute("aria-sort");
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Wrap text" }),
    ).toBeChecked();
    await user.click(screen.getByRole("menuitem", { name: "Columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Played" }));
    second.unmount();

    renderInventoryItemList([...items, another]);
    expect(
      screen.queryByRole("columnheader", { name: "Genre" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Played" })).toBeVisible();
    expect(screen.getByRole("columnheader", { name: "Title" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(
      within(screen.getAllByRole("row")[1]).getByText("Animal Crossing"),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Wrap text" }),
    ).not.toBeChecked();
    expect(mockedUpdateInventoryItem).not.toHaveBeenCalled();
  });

  // Test that removing the active sort column restores API order and keeps the empty row aligned.
  test("clears sorting when its column is hidden and adjusts the empty table span", async () => {
    const user = userEvent.setup();
    const first = renderInventoryItemList();
    await user.click(screen.getByRole("button", { name: "Title" }));
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(screen.getByRole("menuitem", { name: "Columns" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Title" }));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Title" }));
    expect(
      screen.getByRole("columnheader", { name: "Title" }),
    ).not.toHaveAttribute("aria-sort");
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Genre" }));
    first.unmount();
    renderInventoryItemList([]);
    expect(screen.getByRole("cell")).toHaveAttribute("colspan", "2");
  });

  // Test that changing the table view keeps the active sort and never writes item values.
  test("changes text wrapping through the view menu without modifying items or sorting", async () => {
    const user = userEvent.setup();
    const anotherItem: InventoryItem = {
      ...items[0],
      id: "item-2",
      values: [
        { ...items[0].values[0], id: "other-value", value: "Animal Crossing" },
      ],
    };
    renderInventoryItemList([...items, anotherItem]);
    await user.click(screen.getByRole("button", { name: "Title" }));
    await user.click(screen.getByRole("button", { name: "View" }));
    await user.click(
      screen.getByRole("menuitemcheckbox", { name: "Wrap text" }),
    );
    await user.click(screen.getByRole("button", { name: "View" }));
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Wrap text" }),
    ).not.toBeChecked();
    expect(screen.getByRole("columnheader", { name: "Title" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(
      within(screen.getAllByRole("row")[1]).getByText("Animal Crossing"),
    ).toBeVisible();
    expect(mockedUpdateInventoryItem).not.toHaveBeenCalled();
    expect(mockedDeleteInventoryItem).not.toHaveBeenCalled();
  });

  // Test that row actions have a hover surface distinct from the highlighted row.
  test("uses a distinct hover surface for the edit action", async () => {
    renderInventoryItemList();
    expect(screen.getByRole("button", { name: "Edit" })).toHaveClass(
      "enabled:hover:bg-control-hover",
      "enabled:hover:border-accent/50",
    );
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass(
      "enabled:hover:bg-danger/25",
    );
  });
  // Test keyboard sorting, direction announcements, and restoration of API order.
  test("cycles a column through both directions and original order using the keyboard", async () => {
    const user = userEvent.setup();
    const anotherItem: InventoryItem = {
      ...items[0],
      id: "item-2",
      values: [
        { ...items[0].values[0], id: "other-value", value: "Animal Crossing" },
      ],
    };
    const lastItem: InventoryItem = {
      ...items[0],
      id: "item-3",
      values: [
        { ...items[0].values[0], id: "last-value", value: "Stardew Valley" },
      ],
    };
    renderInventoryItemList([...items, anotherItem, lastItem]);

    const heading = screen.getByRole("columnheader", { name: "Title" });
    const sortButton = within(heading).getByRole("button", { name: "Title" });
    expect(heading).not.toHaveAttribute("aria-sort");
    expect(heading.querySelector("svg")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reset sorting" }),
    ).not.toBeInTheDocument();
    sortButton.focus();
    await user.keyboard("{Enter}");
    expect(heading).toHaveAttribute("aria-sort", "ascending");
    expect(heading.querySelector("svg")).toBeInTheDocument();
    expect(
      within(screen.getAllByRole("row")[1]).getByText("Animal Crossing"),
    ).toBeInTheDocument();

    await user.keyboard(" ");
    expect(heading).toHaveAttribute("aria-sort", "descending");
    expect(
      within(screen.getAllByRole("row")[1]).getByText("Stardew Valley"),
    ).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(heading).not.toHaveAttribute("aria-sort");
    expect(heading.querySelector("svg")).not.toBeInTheDocument();
    expect(
      within(screen.getAllByRole("row")[1]).getByText("Baldur's Gate 3"),
    ).toBeInTheDocument();
    await user.click(sortButton);
    expect(heading).toHaveAttribute("aria-sort", "ascending");
  });

  // Test that switching columns starts ascending and moves the single active indicator.
  test("starts each newly selected column ascending with only one sort indicator", async () => {
    const user = userEvent.setup();
    renderInventoryItemList();
    const title = screen.getByRole("columnheader", { name: "Title" });
    const genre = screen.getByRole("columnheader", { name: "Genre" });
    const played = screen.getByRole("columnheader", { name: "Played" });
    const headings = [title, genre, played];
    expect(headings.every((heading) => !heading.querySelector("svg"))).toBe(
      true,
    );

    await user.click(within(title).getByRole("button"));
    await user.click(within(title).getByRole("button"));
    expect(title).toHaveAttribute("aria-sort", "descending");

    await user.click(within(genre).getByRole("button"));
    expect(genre).toHaveAttribute("aria-sort", "ascending");
    expect(title).not.toHaveAttribute("aria-sort");
    expect(title.querySelector("svg")).not.toBeInTheDocument();
    expect(genre.querySelector("svg")).toBeInTheDocument();
    expect(played.querySelector("svg")).not.toBeInTheDocument();

    await user.click(within(title).getByRole("button"));
    expect(title).toHaveAttribute("aria-sort", "ascending");
    expect(genre).not.toHaveAttribute("aria-sort");
    expect(genre.querySelector("svg")).not.toBeInTheDocument();
  });

  // Test that the item list renders fields as columns and items as rows
  test("renders fields as columns and items as rows", async () => {
    renderInventoryItemList();

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Title", "Genre", "Played", "Actions"]);

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Baldur's Gate 3")).toBeInTheDocument();
    expect(within(row).getByText("RPG")).toBeInTheDocument();
    expect(within(row).getByText("Yes")).toBeInTheDocument();
  });

  // Test that an em dash is rendered for a missing field value
  test("renders an em dash for a missing field value", async () => {
    renderInventoryItemList([{ ...items[0], values: [] }]);

    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  // Test that all values are replaced when saving an edited item
  test("replaces all values when saving an edited item", async () => {
    const user = userEvent.setup();
    mockedUpdateInventoryItem.mockResolvedValue(items[0]);
    renderInventoryItemList();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit inventory item" });
    expect(dialog).toBeInTheDocument();
    const titleInput = within(dialog).getByRole("textbox", { name: "Title" });
    await user.clear(titleInput);
    await user.type(titleInput, "Divinity: Original Sin 2");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
        "inventory-1",
        "item-1",
        {
          expected_revision: 1,
          values: [
            { field_id: "title-field", value: "Divinity: Original Sin 2" },
            { field_id: "genre-field", value: ["genre-rpg"] },
            { field_id: "played-field", value: true },
          ],
        },
      );
    });
  });

  // Test that editing can be canceled without submitting changes
  test("cancels editing without submitting changes", async () => {
    const user = userEvent.setup();
    renderInventoryItemList();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("dialog", { name: "Edit inventory item" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedUpdateInventoryItem).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });

  // Test that an item is deleted after the user confirms the action
  test("deletes an item after confirmation", async () => {
    const user = userEvent.setup();
    mockedDeleteInventoryItem.mockResolvedValue();
    renderInventoryItemList();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirmation = screen.getByRole("dialog", {
      name: "Delete inventory item",
    });
    expect(mockedDeleteInventoryItem).not.toHaveBeenCalled();
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(mockedDeleteInventoryItem).toHaveBeenCalledWith(
        "inventory-1",
        "item-1",
        1,
      );
    });
  });

  // Test that an item is not deleted when the user cancels the confirmation
  test("keeps an item when deletion is not confirmed", async () => {
    const user = userEvent.setup();
    renderInventoryItemList();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirmation = screen.getByRole("dialog", {
      name: "Delete inventory item",
    });
    expect(mockedDeleteInventoryItem).not.toHaveBeenCalled();
    await user.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    expect(mockedDeleteInventoryItem).not.toHaveBeenCalled();
  });

  // Test that an API error message is displayed after a failed item update
  test("displays an API error after a failed update", async () => {
    const user = userEvent.setup();
    mockedUpdateInventoryItem.mockRejectedValue(
      new ApiError(422, "Inventory item values are invalid."),
    );
    renderInventoryItemList();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("dialog", { name: "Edit inventory item" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Inventory item values are invalid.",
    );
  });
});

// Test that a failed deletion remains in the confirmation and can be retried.
test("keeps deletion failures in the dialog and closes after retry", async () => {
  const user = userEvent.setup();
  mockedDeleteInventoryItem
    .mockRejectedValueOnce(new Error("Synthetic failure"))
    .mockResolvedValueOnce();
  renderInventoryItemList();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  const confirmation = screen.getByRole("dialog", {
    name: "Delete inventory item",
  });
  await user.click(
    within(confirmation).getByRole("button", { name: "Delete" }),
  );
  expect(await within(confirmation).findByRole("alert")).toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Delete inventory item" }),
  ).toBeInTheDocument();
  await user.click(
    within(confirmation).getByRole("button", { name: "Delete" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
