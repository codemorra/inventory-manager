import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "../../src/services/api";
import { getInventoryFields } from "../../src/services/inventoryFields";
import { getInventoryItems } from "../../src/services/inventoryItems";
import type { InventoryField } from "../../src/types/inventoryField";
import { InventoryItemsPage } from "../../src/pages/InventoryItemsPage";
import { getInventories } from "../../src/services/inventories";

vi.mock("../../src/services/inventories", () => ({
  getInventories: vi.fn().mockResolvedValue([]),
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

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/inventories/inventory-1/items"]}>
        <Routes>
          <Route
            element={<InventoryItemsPage />}
            path="/inventories/:inventoryId/items"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InventoryItemsPage", () => {
  // Test that the inventory context and creation action remain visible above an empty table.
  test("shows the inventory name, description, and empty table toolbar", async () => {
    vi.mocked(getInventories).mockResolvedValueOnce([
      {
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
    expect(await screen.findByText("0 items")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New item" })).toBeEnabled();
    expect(
      screen.getByRole("columnheader", { name: "Title" }),
    ).toBeInTheDocument();
  });

  // Test that a loading state is displayed until fields and items are available
  test("displays a loading state until fields and items are available", () => {
    mockedGetInventoryFields.mockImplementation(
      () => new Promise<never>(() => {}),
    );
    mockedGetInventoryItems.mockResolvedValue([]);

    renderInventoryItemsPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading inventory…");
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
    ).toHaveAttribute("href", "/inventories/inventory-1/fields");
  });

  // Test that an empty state message is displayed when no items exist
  test("displays an empty state when no items exist", async () => {
    mockedGetInventoryFields.mockResolvedValue(fields);
    mockedGetInventoryItems.mockResolvedValue([]);

    renderInventoryItemsPage();

    expect(await screen.findByText("No items yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New item" })).toBeEnabled();
  });

  // Test that returned inventory items are displayed correctly in the field table
  test("displays returned items in the field table", async () => {
    mockedGetInventoryFields.mockResolvedValue(fields);
    mockedGetInventoryItems.mockResolvedValue([
      {
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
