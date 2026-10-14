import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { Navigation } from "../../src/components/layout/Navigation";
import { getInventories } from "../../src/services/inventories";

vi.mock("../../src/services/inventories", () => ({
  getInventories: vi.fn(),
  createInventory: vi.fn(),
}));

const onNavigate = vi.fn();
vi.mock("../../src/services/inventoryGroups", () => ({
  getInventoryGroups: vi.fn().mockResolvedValue([]),
  createInventoryGroup: vi.fn(),
  updateInventoryGroup: vi.fn(),
  deleteInventoryGroup: vi.fn(),
}));
const inventories = [
  { id: "games", name: "Games", description: "Board games" },
  { id: "books", name: "Books", description: "Games and programming" },
].map((inventory) => ({ ...inventory, created_at: "", updated_at: "" }));

beforeEach(() => {
  vi.mocked(getInventories).mockResolvedValue(inventories);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Render sidebar navigation with an active inventory and isolated query cache.
function renderNavigation() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/inventories/games/items"]}>
        <Navigation onNavigate={onNavigate} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Navigation inventory search", () => {
  // Test that filtering ignores case and surrounding spaces and only matches titles.
  test("filters titles while retaining the active inventory link", async () => {
    const user = userEvent.setup();
    renderNavigation();
    await screen.findByRole("link", { name: "Books" });
    await user.type(screen.getByRole("searchbox"), "  GAMES  ");

    const link = screen.getByRole("link", { name: "Games" });
    expect(link).toHaveAttribute("aria-current", "page");
    expect(
      screen.queryByRole("link", { name: "Books" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New inventory" }),
    ).toBeInTheDocument();
    await user.click(link);
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(getInventories).toHaveBeenCalledOnce();
  });

  // Test that clearing an unmatched query restores all links and input focus.
  test("shows no results and clears the query with the clear button", async () => {
    const user = userEvent.setup();
    renderNavigation();
    await screen.findByRole("link", { name: "Games" });
    const input = screen.getByRole("searchbox");
    await user.type(input, "unknown");
    expect(screen.getByRole("status")).toHaveTextContent(
      "No matching inventories.",
    );

    await user.click(
      screen.getByRole("button", { name: "Clear inventory search" }),
    );
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(screen.getByRole("link", { name: "Books" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // Test that Escape resets an active query for keyboard users.
  test("clears the filter with Escape", async () => {
    const user = userEvent.setup();
    renderNavigation();
    await screen.findByRole("link", { name: "Games" });
    const input = screen.getByRole("searchbox");
    await user.type(input, "Books");
    await user.keyboard("{Escape}");
    expect(input).toHaveValue("");
    expect(screen.getByRole("link", { name: "Games" })).toBeInTheDocument();
  });

  // Test that an empty inventory list has its own message rather than a search error.
  test("distinguishes an empty inventory list from missing search matches", async () => {
    vi.mocked(getInventories).mockResolvedValue([]);
    const user = userEvent.setup();
    renderNavigation();
    await screen.findByText("No inventories created yet.");
    await user.type(screen.getByRole("searchbox"), "Games");
    expect(screen.getByText("No inventories created yet.")).toBeInTheDocument();
    expect(
      screen.queryByText("No matching inventories."),
    ).not.toBeInTheDocument();
  });
});
