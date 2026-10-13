import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AppShell } from "../../src/components/layout/AppShell";
import { getInventories } from "../../src/services/inventories";

vi.mock("../../src/services/inventories", () => ({
  createInventory: vi.fn(),
  getInventories: vi.fn(),
}));

const mockedGetInventories = vi.mocked(getInventories);

afterEach(cleanup);

// Render the application shell within an in-memory router.
function renderAppShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AppShell>
          <h1>Page content</h1>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AppShell", () => {
  // Test that the shell displays its primary regions and accessibility link
  test("renders application navigation and page content", () => {
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();

    expect(screen.getByText("Inventory Manager")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Page content" })).toBeVisible();
    expect(
      within(screen.getByRole("complementary")).getByLabelText("Language"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", "#page-content");
  });

  // Test that users can open and close the navigation on small screens
  test("opens and closes the mobile navigation", async () => {
    const user = userEvent.setup();
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const dialog = screen.getByRole("dialog", { name: "Mobile navigation" });
    expect(dialog).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Close menu" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
  });

  // Test that inventories are available directly from the sidebar
  test("renders inventory navigation links", async () => {
    mockedGetInventories.mockResolvedValue([
      {
        id: "inventory-1",
        name: "Games",
        description: null,
        created_at: "2026-10-13T10:00:00Z",
        updated_at: "2026-10-13T10:00:00Z",
      },
    ]);

    renderAppShell();

    expect(await screen.findByRole("link", { name: "Games" })).toHaveAttribute(
      "href",
      "/inventories/inventory-1/items",
    );
  });
});
