import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "../../src/services/api";
import { createInventoryItem } from "../../src/services/inventoryItems";
import type { InventoryField } from "../../src/types/inventoryField";
import { InventoryItemCreateForm } from "../../src/components/InventoryItemCreateForm";
import { chooseOptions } from "../helpers/choices";
import { maximumDurationHours } from "../../src/components/duration";

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

// Test the item form rejects incomplete or unsafe links and submits optional display text structurally.
test("creates a URL item only after entering a valid web address", async () => {
  const user = userEvent.setup();
  renderInventoryItemCreateForm([
    { ...fields[0], name: "Website", field_type: "url", is_required: true },
  ]);
  await user.click(screen.getByRole("button", { name: "New item" }));
  const save = screen.getByRole("button", { name: "Add item" });
  expect(save).toBeDisabled();
  const address = screen.getByLabelText("Website: Web address");
  await user.type(address, "javascript:alert(1)");
  expect(save).toBeDisabled();
  expect(mockedCreateInventoryItem).not.toHaveBeenCalled();
  await user.clear(address);
  await user.type(address, "https://example.com/docs");
  await user.type(
    screen.getByLabelText("Website: Link text (optional)"),
    "Documentation",
  );
  await user.click(save);
  await waitFor(() =>
    expect(mockedCreateInventoryItem).toHaveBeenCalledWith("inventory-1", {
      values: [
        {
          field_id: fields[0].id,
          value: { url: "https://example.com/docs", label: "Documentation" },
        },
      ],
    }),
  );
});

// Test numbering is deferred until save and the read-only preview never enters the payload.
test("shows an automatic ID placeholder and submits no manually assigned number", async () => {
  const user = userEvent.setup();
  renderInventoryItemCreateForm([
    { ...fields[0], name: "Reference", field_type: "id", is_required: true },
  ]);
  await user.click(screen.getByRole("button", { name: "New item" }));
  const input = screen.getByLabelText("Reference");
  expect(input).toHaveAttribute("readonly");
  expect(input).toHaveAttribute("placeholder", "Assigned automatically");
  await user.type(input, "99");
  expect(input).toHaveValue("");
  expect(mockedCreateInventoryItem).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mockedCreateInventoryItem).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "New item" }));
  await user.click(screen.getByRole("button", { name: "Add item" }));
  await waitFor(() =>
    expect(mockedCreateInventoryItem).toHaveBeenCalledWith("inventory-1", {
      values: [],
    }),
  );
});

// Test a duration is converted into integer seconds only at explicit item submission.
test("creates a duration item with hour, minute, and second inputs", async () => {
  const user = userEvent.setup();
  renderInventoryItemCreateForm([
    {
      ...fields[0],
      field_type: "duration",
      name: "Usage time",
      is_required: true,
    },
  ]);
  await user.click(screen.getByRole("button", { name: "New item" }));
  const save = screen.getByRole("button", { name: "Add item" });
  expect(save).toBeDisabled();
  await user.type(screen.getByRole("spinbutton", { name: "Hours" }), "26");
  await user.type(screen.getByRole("spinbutton", { name: "Minutes" }), "15");
  await user.type(screen.getByRole("spinbutton", { name: "Seconds" }), "30");
  expect(mockedCreateInventoryItem).not.toHaveBeenCalled();
  await user.click(save);
  await waitFor(() =>
    expect(mockedCreateInventoryItem).toHaveBeenCalledWith("inventory-1", {
      values: [{ field_id: fields[0].id, value: 94530 }],
    }),
  );
});

// Test optional unset durations remain omitted, while zero is an explicit valid required value.
test.each([false, true])(
  "distinguishes unset and explicit zero durations (required: %s)",
  async (required) => {
    const user = userEvent.setup();
    renderInventoryItemCreateForm([
      { ...fields[0], field_type: "duration", is_required: required },
    ]);
    await user.click(screen.getByRole("button", { name: "New item" }));
    const save = screen.getByRole("button", { name: "Add item" });
    if (required) {
      expect(save).toBeDisabled();
      await user.type(screen.getByRole("spinbutton", { name: "Seconds" }), "0");
    }
    await user.click(save);
    await waitFor(() =>
      expect(mockedCreateInventoryItem).toHaveBeenCalledWith("inventory-1", {
        values: required ? [{ field_id: fields[0].id, value: 0 }] : [],
      }),
    );
  },
);

// Test that invalid optional durations cannot be silently discarded by item submission.
test("blocks saving an optional duration whose combined value overflows", async () => {
  const user = userEvent.setup();
  renderInventoryItemCreateForm([{ ...fields[0], field_type: "duration" }]);
  await user.click(screen.getByRole("button", { name: "New item" }));
  await user.type(
    screen.getByRole("spinbutton", { name: "Hours" }),
    String(maximumDurationHours),
  );
  await user.type(screen.getByRole("spinbutton", { name: "Minutes" }), "59");
  expect(screen.getByRole("button", { name: "Add item" })).toBeDisabled();
  expect(screen.getByRole("alert")).toBeVisible();
  expect(mockedCreateInventoryItem).not.toHaveBeenCalled();
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
  expect(screen.getByRole("combobox", { name: /Played/ })).toHaveTextContent(
    "No selection",
  );
  expect(screen.getByRole("combobox", { name: /Played/ })).toHaveAttribute(
    "aria-required",
    "true",
  );
  await user.type(screen.getByRole("textbox", { name: /Title/ }), "   ");
  await user.type(screen.getByRole("spinbutton", { name: /Rating/ }), "0");
  await chooseOptions(user, "Played", ["No"]);
  await chooseOptions(user, "Platform", ["PC"]);
  await chooseOptions(user, "Genre", ["RPG"]);
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
    await chooseOptions(user, "Platform", ["PC"]);
    await chooseOptions(user, "Genre", ["RPG", "Strategy"]);
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
