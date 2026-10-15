import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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
  expect(screen.getByRole("combobox", { name: /Played/ })).toHaveValue("");
  await user.type(screen.getByRole("textbox", { name: /Title/ }), "Cable");
  await user.selectOptions(
    screen.getByRole("listbox", { name: /Genre/ }),
    "genre-rpg",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Played/ }),
    "false",
  );
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
