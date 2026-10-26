import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AppShell } from "../../src/components/layout/AppShell";
import { InventoryItemsPage } from "../../src/pages/InventoryItemsPage";
import { InventoryOverviewPage } from "../../src/pages/InventoryOverviewPage";
import {
  createInventory,
  getInventories,
} from "../../src/services/inventories";

vi.mock("../../src/services/inventories", () => ({
  createInventory: vi.fn(),
  getInventories: vi.fn(),
  updateInventory: vi.fn(),
  deleteInventory: vi.fn(),
}));
vi.mock("../../src/services/inventoryTemplates", () => ({
  getInventoryTemplates: vi.fn().mockResolvedValue([]),
  instantiateInventoryTemplate: vi.fn(),
}));
vi.mock("../../src/services/inventoryGroups", () => ({
  getInventoryGroups: vi.fn().mockResolvedValue([]),
  createInventoryGroup: vi.fn(),
  updateInventoryGroup: vi.fn(),
  deleteInventoryGroup: vi.fn(),
}));
vi.mock("../../src/services/inventoryFields", () => ({
  getInventoryFields: vi.fn().mockResolvedValue([]),
  createInventoryField: vi.fn(),
}));
vi.mock("../../src/services/inventoryItems", () => ({
  getInventoryItems: vi.fn().mockResolvedValue([]),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Test that creation opens the new inventory without automatically opening an editor.
test.each([
  { initialPath: "/", mobile: false },
  { initialPath: "/inventories/existing/items", mobile: true },
])(
  "opens the new inventory without a dialog from $initialPath (mobile: $mobile)",
  async ({ initialPath, mobile }) => {
    const user = userEvent.setup();
    const existing = {
      configuration_revision: 1,
      id: "existing",
      name: "Existing collection",
      description: null,
      created_at: "",
      updated_at: "",
    };
    const created = { ...existing, id: "new-inventory", name: "Games" };
    let saved = false;
    vi.mocked(getInventories).mockImplementation(async () =>
      saved ? [existing, created] : [existing],
    );
    vi.mocked(createInventory).mockImplementation(async () => {
      saved = true;
      return created;
    });
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        <MemoryRouter initialEntries={[initialPath]}>
          <AppShell>
            <Routes>
              <Route path="/" element={<InventoryOverviewPage />} />
              <Route
                path="/inventories/:inventoryId/items"
                element={<InventoryItemsPage />}
              />
            </Routes>
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    if (mobile) {
      await user.click(screen.getByRole("button", { name: "Open menu" }));
      await user.click(
        within(
          screen.getByRole("dialog", { name: "Mobile navigation" }),
        ).getByRole("button", { name: "New inventory" }),
      );
    } else {
      await user.click(screen.getByRole("button", { name: "New inventory" }));
    }
    await user.type(screen.getByLabelText("Name"), "Games");
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    expect(
      await screen.findByRole("heading", { name: "Games" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Inventory settings" }),
    ).toBeEnabled();
    expect(createInventory).toHaveBeenCalledOnce();
  },
);
