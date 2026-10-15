import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
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
} from "../../src/services/inventoryItems";
import type { InventoryField } from "../../src/types/inventoryField";
import type { InventoryItem } from "../../src/types/inventoryItem";
import { InventoryItemList } from "../../src/components/InventoryItemList";
import { chooseOptions } from "../helpers/choices";

vi.mock("../../src/services/inventoryItems", () => ({
  createInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
  getInventoryItems: vi.fn(),
  updateInventoryItem: vi.fn(),
}));

const mockedDeleteInventoryItem = vi.mocked(deleteInventoryItem);
const mockedUpdateInventoryItem = vi.mocked(updateInventoryItem);
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
function renderInventoryItemList(testItems = items, testFields = fields) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <InventoryItemList fields={testFields} items={testItems} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
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
  const input = screen.getByLabelText("Reference");
  expect(input).toHaveValue("42");
  expect(input).toHaveAttribute("readonly");
  await user.type(input, "99");
  expect(input).toHaveValue("42");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
      "inventory-1",
      "item-1",
      { values: [] },
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
      { values: [{ field_id: duration.id, value: 98130 }] },
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
      { values: [{ field_id: duration.id, value: 0 }] },
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
      { values: [] },
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
      { values: [] },
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
      <InventoryItemList fields={fields} items={testItems} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Title" }));
  expect(
    within(screen.getAllByRole("row")[1]).getByText("Animal Crossing"),
  ).toBeVisible();
  view.rerender(
    <QueryClientProvider client={client}>
      <InventoryItemList
        fields={fields.map((field) => ({ ...field, is_sortable: false }))}
        items={testItems}
      />
    </QueryClientProvider>,
  );
  const header = screen.getByRole("columnheader", { name: "Title" });
  expect(within(header).queryByRole("button")).not.toBeInTheDocument();
  expect(header).not.toHaveAttribute("aria-sort");
  expect(
    screen.queryByRole("button", { name: "Reset sorting" }),
  ).not.toBeInTheDocument();
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
  // Test that row actions have a hover surface distinct from the highlighted row.
  test("uses a distinct hover surface for the edit action", () => {
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
  test("sorts a column in both directions and resets the order", async () => {
    const user = userEvent.setup();
    const anotherItem: InventoryItem = {
      ...items[0],
      id: "item-2",
      values: [
        { ...items[0].values[0], id: "other-value", value: "Animal Crossing" },
      ],
    };
    renderInventoryItemList([...items, anotherItem]);

    const heading = screen.getByRole("columnheader", { name: "Title" });
    const sortButton = within(heading).getByRole("button", { name: "Title" });
    sortButton.focus();
    await user.keyboard("{Enter}");
    expect(heading).toHaveAttribute("aria-sort", "ascending");
    expect(
      within(screen.getAllByRole("row")[1]).getByText("Animal Crossing"),
    ).toBeInTheDocument();

    await user.click(sortButton);
    expect(heading).toHaveAttribute("aria-sort", "descending");
    expect(
      within(screen.getAllByRole("row")[1]).getByText("Baldur's Gate 3"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset sorting" }));
    expect(heading).not.toHaveAttribute("aria-sort");
    expect(
      within(screen.getAllByRole("row")[1]).getByText("Baldur's Gate 3"),
    ).toBeInTheDocument();
  });

  // Test that the item list renders fields as columns and items as rows
  test("renders fields as columns and items as rows", () => {
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
  test("renders an em dash for a missing field value", () => {
    renderInventoryItemList([{ ...items[0], values: [] }]);

    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  // Test that all values are replaced when saving an edited item
  test("replaces all values when saving an edited item", async () => {
    const user = userEvent.setup();
    mockedUpdateInventoryItem.mockResolvedValue(items[0]);
    renderInventoryItemList();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("dialog", { name: "Edit inventory item" }),
    ).toBeInTheDocument();
    const titleInput = screen.getByLabelText("Title");
    await user.clear(titleInput);
    await user.type(titleInput, "Divinity: Original Sin 2");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
        "inventory-1",
        "item-1",
        {
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
