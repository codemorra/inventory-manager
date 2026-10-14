// Test the field configuration panel and legacy field route.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "../../src/services/api";
import { getInventoryFields } from "../../src/services/inventoryFields";
import { InventoryFieldsPanel } from "../../src/components/InventoryFieldsPanel";
import { InventoryFieldsPage } from "../../src/pages/InventoryFieldsPage";
import { useLocation } from "react-router-dom";

vi.mock("../../src/services/inventories", () => ({
  getInventories: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/services/inventoryFields", () => ({
  createInventoryField: vi.fn(),
  deleteInventoryField: vi.fn(),
  getInventoryFields: vi.fn(),
  updateInventoryField: vi.fn(),
}));

const mockedGetInventoryFields = vi.mocked(getInventoryFields);

// Expose the redirected URL without rendering the item page.
function RedirectLocation() {
  const location = useLocation();
  return <p>{location.pathname + location.search}</p>;
}

// Test that bookmarks open field settings in the inventory editor.
test("redirects the old fields route to the editor", async () => {
  render(
    <MemoryRouter initialEntries={["/inventories/inventory-1/fields"]}>
      <Routes>
        <Route
          path="/inventories/:inventoryId/fields"
          element={<InventoryFieldsPage />}
        />
        <Route
          path="/inventories/:inventoryId/items"
          element={<RedirectLocation />}
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    await screen.findByText("/inventories/inventory-1/items?edit=fields"),
  ).toBeInTheDocument();
});

/** Render the inventory field page with an isolated query client. */
function renderInventoryFieldsPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/inventories/inventory-1/fields"]}>
        <Routes>
          <Route
            element={<InventoryFieldsPanel inventoryId="inventory-1" />}
            path="/inventories/:inventoryId/fields"
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

describe("InventoryFieldsPanel", () => {
  // Test that a loading message is displayed while fields are being fetched
  test("displays a loading message while fields are loading", () => {
    mockedGetInventoryFields.mockImplementation(
      () => new Promise<never>(() => {}),
    );

    renderInventoryFieldsPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading fields…");
  });

  // Test that an API error message is displayed after a failed fetch
  test("displays an API error message", async () => {
    mockedGetInventoryFields.mockRejectedValue(
      new ApiError(500, "Unable to reach the backend."),
    );

    renderInventoryFieldsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
  });

  // Test that an empty state message is displayed when no fields exist
  test("displays an empty state when no fields exist", async () => {
    mockedGetInventoryFields.mockResolvedValue([]);

    renderInventoryFieldsPage();

    expect(
      await screen.findByText("No fields configured yet."),
    ).toBeInTheDocument();
  });

  // Test that returned inventory fields are displayed correctly
  test("displays returned inventory fields", async () => {
    mockedGetInventoryFields.mockResolvedValue([
      {
        id: "field-1",
        inventory_id: "inventory-1",
        name: "Brand",
        field_type: "text",
        max_length: 255,
        options: [],
        position: 0,
        created_at: "2026-09-15T10:00:00Z",
        updated_at: "2026-09-15T10:00:00Z",
      },
    ]);

    renderInventoryFieldsPage();

    const fieldCard = (await screen.findByText("Brand")).closest("article");

    expect(fieldCard).not.toBeNull();
    expect(within(fieldCard!).getByText("Text")).toBeInTheDocument();
  });
});
