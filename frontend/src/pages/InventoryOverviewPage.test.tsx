import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../services/api";
import { getInventories } from "../services/inventories";
import { InventoryOverviewPage } from "./InventoryOverviewPage";

vi.mock("../services/inventories", () => ({
  getInventories: vi.fn(),
}));

const mockedGetInventories = vi.mocked(getInventories);

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
      <InventoryOverviewPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InventoryOverviewPage", () => {
  it("displays a loading message while inventories are loading", () => {
    mockedGetInventories.mockImplementation(
      () => new Promise<never>(() => {}),
    );

    renderInventoryOverviewPage();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading inventories…",
    );
  });

  it("displays an API error message", async () => {
    mockedGetInventories.mockRejectedValue(
      new ApiError(500, "Unable to reach the backend."),
    );

    renderInventoryOverviewPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
  });

  it("displays an empty state when no inventories exist", async () => {
    mockedGetInventories.mockResolvedValue([]);

    renderInventoryOverviewPage();

    expect(await screen.findByText("No inventories yet.")).toBeInTheDocument();
  });

  it("displays returned inventories", async () => {
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

    expect(await screen.findByRole("heading", { name: "Cables" })).toBeInTheDocument();
    expect(screen.getByText("Cable collection")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tools" })).toBeInTheDocument();
  });
});
