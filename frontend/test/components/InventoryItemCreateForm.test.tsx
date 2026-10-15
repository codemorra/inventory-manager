import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "../../src/services/api";
import { createInventoryItem } from "../../src/services/inventoryItems";
import type { InventoryField } from "../../src/types/inventoryField";
import { InventoryItemCreateForm } from "../../src/components/InventoryItemCreateForm";

vi.mock("../../src/services/inventoryItems", () => ({
  createInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
  getInventoryItems: vi.fn(),
  updateInventoryItem: vi.fn(),
}));

const mockedCreateInventoryItem = vi.mocked(createInventoryItem);
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
    id: "rating-field",
    inventory_id: "inventory-1",
    name: "Rating",
    field_type: "number",
    max_length: null,
    is_required: false,
    is_sortable: true,
    options: [],
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
  {
    id: "platform-field",
    inventory_id: "inventory-1",
    name: "Platform",
    field_type: "select",
    max_length: null,
    is_required: false,
    is_sortable: true,
    options: [
      {
        id: "platform-pc",
        field_id: "platform-field",
        name: "PC",
        position: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    position: 3,
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
      {
        id: "genre-strategy",
        field_id: "genre-field",
        name: "Strategy",
        position: 1,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    position: 4,
    created_at: timestamp,
    updated_at: timestamp,
  },
];

/** Render the item creation form with an isolated query client. */
function renderInventoryItemCreateForm(testFields = fields) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <InventoryItemCreateForm fields={testFields} inventoryId="inventory-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Test every required input family and intentional no/zero values during item creation.
test("requires filled inputs and an explicit yes/no choice before creating", async () => {
  const user = userEvent.setup();
  renderInventoryItemCreateForm(
    fields.map((field) => ({ ...field, is_required: true })),
  );
  await user.click(screen.getByRole("button", { name: "New item" }));
  const save = screen.getByRole("button", { name: "Add item" });
  expect(save).toBeDisabled();
  expect(screen.getByRole("combobox", { name: /Played/ })).toHaveValue("");
  await user.type(screen.getByRole("textbox", { name: /Title/ }), "   ");
  await user.type(screen.getByRole("spinbutton", { name: /Rating/ }), "0");
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Played/ }),
    "false",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Platform/ }),
    "platform-pc",
  );
  await user.selectOptions(
    screen.getByRole("listbox", { name: /Genre/ }),
    "genre-rpg",
  );
  expect(save).toBeDisabled();
  await user.clear(screen.getByRole("textbox", { name: /Title/ }));
  await user.type(screen.getByRole("textbox", { name: /Title/ }), "Example");
  expect(save).toBeEnabled();
  await user.click(save);
  await waitFor(() =>
    expect(mockedCreateInventoryItem).toHaveBeenCalledWith("inventory-1", {
      values: [
        { field_id: "title-field", value: "Example" },
        { field_id: "rating-field", value: 0 },
        { field_id: "played-field", value: false },
        { field_id: "platform-field", value: "platform-pc" },
        { field_id: "genre-field", value: ["genre-rpg"] },
      ],
    }),
  );
});

describe("InventoryItemCreateForm", () => {
  // Test that the form submits values matching their configured field types
  test("submits values matching their configured field types", async () => {
    const user = userEvent.setup();
    mockedCreateInventoryItem.mockResolvedValue({
      id: "item-1",
      inventory_id: "inventory-1",
      values: [],
      created_at: timestamp,
      updated_at: timestamp,
    });

    renderInventoryItemCreateForm();
    await user.click(screen.getByRole("button", { name: "New item" }));

    await user.type(screen.getByLabelText("Title"), "Baldur's Gate 3");
    await user.type(screen.getByLabelText("Rating"), "9.5");
    await user.click(screen.getByLabelText("Played"));
    await user.selectOptions(screen.getByLabelText("Platform"), "platform-pc");
    await user.selectOptions(screen.getByLabelText("Genre"), [
      "genre-rpg",
      "genre-strategy",
    ]);
    await user.click(screen.getByRole("button", { name: "Add item" }));

    await waitFor(() => {
      expect(mockedCreateInventoryItem).toHaveBeenCalledWith("inventory-1", {
        values: [
          { field_id: "title-field", value: "Baldur's Gate 3" },
          { field_id: "rating-field", value: 9.5 },
          { field_id: "played-field", value: true },
          { field_id: "platform-field", value: "platform-pc" },
          {
            field_id: "genre-field",
            value: ["genre-rpg", "genre-strategy"],
          },
        ],
      });
    });
  });

  // Test that the form clears its values after a successful item creation
  test("clears values after successful creation", async () => {
    const user = userEvent.setup();
    mockedCreateInventoryItem.mockResolvedValue({
      id: "item-1",
      inventory_id: "inventory-1",
      values: [],
      created_at: timestamp,
      updated_at: timestamp,
    });

    renderInventoryItemCreateForm();
    await user.click(screen.getByRole("button", { name: "New item" }));
    const titleInput = screen.getByLabelText("Title");

    await user.type(titleInput, "Catan");
    await user.click(screen.getByRole("button", { name: "Add item" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "New item" }));

    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  // Test that an API error message is displayed after a failed item creation
  test("displays an API error after failed creation", async () => {
    const user = userEvent.setup();
    mockedCreateInventoryItem.mockRejectedValue(
      new ApiError(422, "Inventory item values are invalid."),
    );

    renderInventoryItemCreateForm();
    await user.click(screen.getByRole("button", { name: "New item" }));
    await user.click(screen.getByRole("button", { name: "Add item" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Inventory item values are invalid.",
    );
  });

  // Test that the "New item" button is disabled when no fields are configured
  test("disables creation when no fields are configured", () => {
    renderInventoryItemCreateForm([]);

    expect(screen.getByRole("button", { name: "New item" })).toBeDisabled();
    expect(
      screen.getByText("Configure at least one field before adding items."),
    ).toBeInTheDocument();
  });
});
