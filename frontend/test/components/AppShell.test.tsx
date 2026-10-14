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
  updateInventory: vi.fn(),
}));

const mockedGetInventories = vi.mocked(getInventories);
vi.mock("../../src/services/inventoryGroups", () => ({
  getInventoryGroups: vi.fn().mockResolvedValue([]),
  createInventoryGroup: vi.fn(),
  updateInventoryGroup: vi.fn(),
  deleteInventoryGroup: vi.fn(),
}));

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
  // Test that group creation replaces mobile navigation with a single dialog.
  test("opens group creation from mobile navigation", async () => {
    const user = userEvent.setup();
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const navigation = screen.getByRole("dialog", {
      name: "Mobile navigation",
    });
    await user.click(
      within(navigation).getByRole("button", { name: "New group" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "New group" }),
    ).toBeInTheDocument();
  });

  // Test that language is configured in settings and changes the full interface.
  test("opens settings and changes the application language", async () => {
    const user = userEvent.setup();
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();

    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Appearance")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Blue" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(within(dialog).getByLabelText("Appearance")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Blue" }));
    expect(document.documentElement.dataset.accent).toBe("blue");
    await user.selectOptions(within(dialog).getByLabelText("Language"), "de");

    expect(
      screen.getByRole("dialog", { name: "Einstellungen" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Dialog schließen" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Test that mobile settings replace the navigation overlay with one dialog.
  test("opens settings from mobile navigation", async () => {
    const user = userEvent.setup();
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const navigation = screen.getByRole("dialog", {
      name: "Mobile navigation",
    });
    await user.click(
      within(navigation).getByRole("button", { name: "Settings" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Settings" }),
    ).toBeInTheDocument();
  });

  // Test that the shell displays its primary regions and accessibility link
  test("renders application navigation and page content", () => {
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();

    expect(screen.getByText("Inventory Manager")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Page content" })).toBeVisible();
    expect(
      within(screen.getByRole("complementary")).getByRole("button", {
        name: "Settings",
      }),
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
