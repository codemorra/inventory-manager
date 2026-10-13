import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { ApiError } from "../../src/services/api";
import { getInventories } from "../../src/services/inventories";
import { InventoryOverviewPage } from "../../src/pages/InventoryOverviewPage";

vi.mock("../../src/services/inventories", () => ({
  createInventory: vi.fn(),
  deleteInventory: vi.fn(),
  getInventories: vi.fn(),
  updateInventory: vi.fn(),
}));
const mockedGetInventories = vi.mocked(getInventories);

/** Render the overview page with an isolated query client. */
function renderInventoryOverviewPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <InventoryOverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InventoryOverviewPage", () => {
  // Test that a loading message is displayed while inventories are being fetched
  test("displays a loading message while inventories are loading", () => {
    mockedGetInventories.mockImplementation(() => new Promise<never>(() => {}));

    renderInventoryOverviewPage();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading inventories…",
    );
  });

  // Test that an API error message is displayed after a failed fetch
  test("displays an API error message", async () => {
    mockedGetInventories.mockRejectedValue(
      new ApiError(500, "Unable to reach the backend."),
    );

    renderInventoryOverviewPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
  });

  // Test that an empty state message is displayed when no inventories exist
  test("displays an empty state when no inventories exist", async () => {
    mockedGetInventories.mockResolvedValue([]);

    renderInventoryOverviewPage();

    expect(await screen.findByText("No inventories yet.")).toBeInTheDocument();
  });

  // Test that returned inventories are displayed correctly
  test("displays returned inventories", async () => {
    mockedGetInventories.mockResolvedValue([
      {
        id: "inventory-1",
        name: "Cables",
        description: "Cable collection",
        created_at: "2026-09-14T10:00:00Z",
        updated_at: "2026-09-14T10:00:00Z",
      },
      {
        id: "inventory-2",
        name: "Tools",
        description: null,
        created_at: "2026-09-14T10:00:00Z",
        updated_at: "2026-09-14T10:00:00Z",
      },
    ]);

    renderInventoryOverviewPage();

    expect(await screen.findByText("Cables")).toBeInTheDocument();
    expect(screen.getByText("Cable collection")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
  });
});
