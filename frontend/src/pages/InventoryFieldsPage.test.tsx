/** Test the inventory field overview page. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../services/api";
import { getInventoryFields } from "../services/inventoryFields";
import { InventoryFieldsPage } from "./InventoryFieldsPage";

vi.mock("../services/inventoryFields", () => ({
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
  it("displays a loading message while fields are loading", () => {
    mockedGetInventoryFields.mockImplementation(
      () => new Promise<never>(() => {}),
    );

    renderInventoryFieldsPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading fields…");
  });

  it("displays an API error message", async () => {
    mockedGetInventoryFields.mockRejectedValue(
      new ApiError(500, "Unable to reach the backend."),
    );

    renderInventoryFieldsPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
  });

  it("displays an empty state when no fields exist", async () => {
    mockedGetInventoryFields.mockResolvedValue([]);

    renderInventoryFieldsPage();

    expect(
      await screen.findByText("No fields configured yet."),
    ).toBeInTheDocument();
  });

  it("displays returned inventory fields", async () => {
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

    expect(await screen.findByText("Brand")).toBeInTheDocument();
    expect(screen.getByText("text")).toBeInTheDocument();
  });
});
