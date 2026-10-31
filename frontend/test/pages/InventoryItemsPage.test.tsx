import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useState } from "react";
import { TableEditSessionContext } from "../../src/components/tableEditSession";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "../../src/services/api";
import { getInventoryFields } from "../../src/services/inventoryFields";
vi.mock("../../src/services/inventoryEditor", () => ({
  saveInventoryConfiguration: vi.fn(),
  getInventoryConfiguration: vi.fn(async () => ({
    inventory: {
      id: "inventory-1",
      name: "Games",
      description: null,
      configuration_revision: 1,
      created_at: "",
      updated_at: "",
    },
    fields: await getInventoryFields("inventory-1"),
  })),
}));
import { getInventoryItems } from "../../src/services/inventoryItems";
import type { InventoryField } from "../../src/types/inventoryField";
import { InventoryItemsPage } from "../../src/pages/InventoryItemsPage";
import { getInventories } from "../../src/services/inventories";

vi.mock("../../src/services/inventories", () => ({
  getInventories: vi.fn().mockResolvedValue([]),
  updateInventory: vi.fn(),
}));

vi.mock("../../src/services/inventoryFields", () => ({
  createInventoryField: vi.fn(),
  deleteInventoryField: vi.fn(),
  getInventoryFields: vi.fn(),
  updateInventoryField: vi.fn(),
}));

vi.mock("../../src/services/inventoryItems", () => ({
  createInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
  getInventoryItems: vi.fn(),
  updateInventoryItem: vi.fn(),
}));

const mockedGetInventoryFields = vi.mocked(getInventoryFields);
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
];

/** Render the inventory item page with an isolated query client. */
function renderInventoryItemsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Session() {
    const [inventoryId, setInventoryId] = useState<string | null>(null);
    return (
      <TableEditSessionContext.Provider value={{ inventoryId, setInventoryId }}>
        <MemoryRouter initialEntries={["/inventories/inventory-1/items"]}>
          <Routes>
            <Route
              element={<InventoryItemsPage />}
              path="/inventories/:inventoryId/items"
            />
          </Routes>
        </MemoryRouter>
      </TableEditSessionContext.Provider>
    );
  }
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Session />
    </QueryClientProvider>,
  );
  return { ...view, client: queryClient };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InventoryItemsPage", () => {
  // Test background query failures or a removed configuration cannot unmount an unsaved table draft.
  test("preserves the active table when background data fails or fields disappear", async () => {
    const user = userEvent.setup();
    mockedGetInventoryFields.mockResolvedValue(fields);
    mockedGetInventoryItems.mockResolvedValue([
      {
        id: "item",
        inventory_id: "inventory-1",
        revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
        values: [
          {
            id: "value",
            field_id: "title-field",
            value: "Game",
            created_at: timestamp,
            updated_at: timestamp,
          },
        ],
      },
    ]);
    const { client } = renderInventoryItemsPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit table" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Edit table" }));
    const input = await screen.findByRole("textbox", { name: "Title" });
    await user.clear(input);
    await user.type(input, "Local draft");
    mockedGetInventoryFields.mockRejectedValueOnce(
      new Error("Background failure"),
    );
    await act(async () => {
      await client.refetchQueries({
        queryKey: ["inventories", "inventory-1", "fields"],
        exact: true,
      });
    });
    expect(input).toBeVisible();
    expect(input).toHaveValue("Local draft");
    act(() => {
      client.setQueryData(["inventories", "inventory-1", "fields"], []);
      client.setQueryData(["inventories", "inventory-1", "items"], []);
    });
    expect(input).toBeVisible();
    expect(input).toHaveValue("Local draft");
    expect(screen.queryByText("No fields configured")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      await screen.findByRole("heading", { name: "No fields configured" }),
    ).toBeVisible();
  });
  // Test the real page's settings and creation actions share the active table-edit lock.
  test("locks inventory settings and creation until table editing ends", async () => {
    const user = userEvent.setup();
    vi.mocked(getInventories).mockResolvedValueOnce([
      {
        configuration_revision: 1,
        id: "inventory-1",
        name: "Games",
        description: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    mockedGetInventoryFields.mockResolvedValue(fields);
    mockedGetInventoryItems.mockResolvedValue([
      {
        id: "item",
        inventory_id: "inventory-1",
        revision: 1,
        created_at: timestamp,
        updated_at: timestamp,
        values: [
          {
            id: "value",
            field_id: "title-field",
            value: "Game",
            created_at: timestamp,
            updated_at: timestamp,
          },
        ],
      },
    ]);
    renderInventoryItemsPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit table" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Edit table" }));
    expect(await screen.findByRole("textbox", { name: "Title" })).toHaveValue(
      "Game",
    );
    expect(
      screen.getByRole("button", { name: "Inventory settings" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "New item" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Inventory settings" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "New item" })).toBeEnabled();
  });
  // Test that the settings icon beside the title opens the shared inventory editor.
  test("opens inventory settings from the title row", async () => {
    const user = userEvent.setup();
    vi.mocked(getInventories).mockResolvedValueOnce([
      {
        configuration_revision: 1,
        id: "inventory-1",
        name: "Games",
        description: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    mockedGetInventoryFields.mockResolvedValue(fields);
    mockedGetInventoryItems.mockResolvedValue([]);
    renderInventoryItemsPage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "New item" })).toBeEnabled(),
    );
    const header = screen
      .getByRole("heading", { name: "Games" })
      .closest("header")!;
    const settings = within(header).getByRole("button", {
      name: "Inventory settings",
    });
    expect(settings).toHaveAttribute("title", "Inventory settings");
    const controls = screen.getByRole("group", {
      name: "Inventory table controls",
    });
    expect(within(controls).getByRole("searchbox")).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "Filters" })).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "View" })).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "Edit table" })).toBeDisabled();
    await user.click(settings);
    expect(
      screen.getByRole("dialog", { name: "Edit inventory" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.queryByRole("link", { name: "Fields" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  // Test that empty inventories show the toolbar and enable only item creation once fields exist.
  test("shows a disabled empty table toolbar while allowing item creation", async () => {
    vi.mocked(getInventories).mockResolvedValueOnce([
      {
        configuration_revision: 1,
        id: "inventory-1",
        name: "Games",
        description: "My game collection",
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    mockedGetInventoryFields.mockResolvedValue(fields);
    mockedGetInventoryItems.mockResolvedValue([]);
    renderInventoryItemsPage();

    expect(
      await screen.findByRole("heading", { name: "Games" }),
    ).toBeInTheDocument();
    expect(screen.getByText("My game collection")).toBeInTheDocument();
    const header = screen
      .getByRole("heading", { name: "Games" })
      .closest("header")!;
    expect(header.querySelectorAll("p")).toHaveLength(1);
    expect(within(header).queryByText("Inventories")).not.toBeInTheDocument();
    const controls = screen.getByRole("group", {
      name: "Inventory table controls",
    });
    expect(within(controls).getByRole("searchbox")).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "Filters" })).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "View" })).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "Edit table" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New item" })).toBeEnabled();
    expect(
      screen.getByRole("columnheader", { name: "Title" }),
    ).toBeInTheDocument();
  });

  // Test that missing or blank descriptions leave no placeholder beneath the title.
  test.each([null, "", "   "])(
    "omits the header description when it is %j",
    async (description) => {
      vi.mocked(getInventories).mockResolvedValueOnce([
        {
          configuration_revision: 1,
          id: "inventory-1",
          name: "Games",
          description,
          created_at: timestamp,
          updated_at: timestamp,
        },
      ]);
      mockedGetInventoryFields.mockResolvedValue(fields);
      mockedGetInventoryItems.mockResolvedValue([]);
      renderInventoryItemsPage();

      const title = await screen.findByRole("heading", { name: "Games" });
      const header = title.closest("header")!;
      expect(header.querySelector("p")).not.toBeInTheDocument();
      expect(
        within(header).getByRole("button", { name: "Inventory settings" }),
      ).toBeEnabled();
      expect(
        screen.getByRole("button", { name: "Inventory settings" }),
      ).toBeEnabled();
    },
  );

  // Test that an inventory without fields still has direct access to its editor.
  test("opens the editor for an inventory without fields", async () => {
    const user = userEvent.setup();
    vi.mocked(getInventories).mockResolvedValueOnce([
      {
        configuration_revision: 1,
        id: "inventory-1",
        name: "Games",
        description: null,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);
    mockedGetInventoryFields.mockResolvedValue([]);
    mockedGetInventoryItems.mockResolvedValue([]);
    renderInventoryItemsPage();
    await screen.findByRole("heading", { name: "No fields configured" });
    const controls = screen.getByRole("group", {
      name: "Inventory table controls",
    });
    expect(within(controls).getByRole("searchbox")).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "Filters" })).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "View" })).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "Edit table" })).toBeDisabled();
    expect(within(controls).getByRole("button", { name: "New item" })).toBeDisabled();
    await user.click(
      screen.getByRole("button", { name: "Inventory settings" }),
    );
    await user.click(screen.getByRole("button", { name: "Fields" }));
    expect(
      screen.getByRole("dialog", { name: "Edit inventory" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Fields" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // Test that a loading state is displayed until fields and items are available
  test("displays a loading state until fields and items are available", () => {
    mockedGetInventoryFields.mockImplementation(
      () => new Promise<never>(() => {}),
    );
    mockedGetInventoryItems.mockResolvedValue([]);

    renderInventoryItemsPage();

    expect(screen.getByText("Loading inventory…")).toHaveAttribute("role", "status");
  });

  // Test that an API error message is displayed when the item request fails
  test("displays an API error from the item request", async () => {
    mockedGetInventoryFields.mockResolvedValue(fields);
    mockedGetInventoryItems.mockRejectedValue(
      new ApiError(500, "Unable to reach the backend."),
    );

    renderInventoryItemsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
  });

  // Test that a link to field configuration is displayed when no fields exist
  test("links to field configuration when no fields exist", async () => {
    mockedGetInventoryFields.mockResolvedValue([]);
    mockedGetInventoryItems.mockResolvedValue([]);

    renderInventoryItemsPage();

    expect(
      await screen.findByRole("heading", { name: "No fields configured" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Configure fields" }),
    ).toHaveAttribute("href", "/inventories/inventory-1/items?edit=fields");
  });

  // Test that an empty state message is displayed when no items exist
  test("displays an empty state when no items exist", async () => {
    mockedGetInventoryFields.mockResolvedValue(fields);
    mockedGetInventoryItems.mockResolvedValue([]);

    renderInventoryItemsPage();

    expect(await screen.findByText("No items yet.")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "New item" })).toBeEnabled(),
    );
  });

  // Test that returned inventory items are displayed correctly in the field table
  test("displays returned items in the field table", async () => {
    mockedGetInventoryFields.mockResolvedValue(fields);
    mockedGetInventoryItems.mockResolvedValue([
      {
        revision: 1,
        id: "item-1",
        inventory_id: "inventory-1",
        values: [
          {
            id: "value-1",
            field_id: "title-field",
            value: "Catan",
            created_at: timestamp,
            updated_at: timestamp,
          },
        ],
        created_at: timestamp,
        updated_at: timestamp,
      },
    ]);

    renderInventoryItemsPage();

    expect(await screen.findByText("Catan")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Title" }),
    ).toBeInTheDocument();
  });
});
