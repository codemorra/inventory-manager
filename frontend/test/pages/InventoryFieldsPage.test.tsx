/** Test the inventory field overview page. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "../../src/services/api";
import { getInventoryFields } from "../../src/services/inventoryFields";
import { InventoryFieldsPage } from "../../src/pages/InventoryFieldsPage";

vi.mock("../../src/services/inventoryFields", () => ({
  createInventoryField: vi.fn(),
  deleteInventoryField: vi.fn(),
  getInventoryFields: vi.fn(),
  updateInventoryField: vi.fn(),
}));

const mockedGetInventoryFields = vi.mocked(getInventoryFields);

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
            element={<InventoryFieldsPage />}
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

describe("InventoryFieldsPage", () => {
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
