import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InventoryItemsPage } from "../../src/pages/InventoryItemsPage";
import { inventoryItemsLoader } from "../../src/loaders/inventoryItems";
import { queryClient } from "../../src/queryClient";
import { getInventories } from "../../src/services/inventories";
import { getInventoryFields } from "../../src/services/inventoryFields";
import { getInventoryItems } from "../../src/services/inventoryItems";
import type { InventoryField } from "../../src/types/inventoryField";
import type { InventoryItem } from "../../src/types/inventoryItem";

vi.mock("../../src/services/inventories", async (original) => ({
  ...(await original<typeof import("../../src/services/inventories")>()),
  getInventories: vi.fn(),
}));
vi.mock("../../src/services/inventoryFields", async (original) => ({
  ...(await original<typeof import("../../src/services/inventoryFields")>()),
  getInventoryFields: vi.fn(),
}));
vi.mock("../../src/services/inventoryItems", async (original) => ({
  ...(await original<typeof import("../../src/services/inventoryItems")>()),
  getInventoryItems: vi.fn(),
}));

const field: InventoryField = {
  id: "title",
  inventory_id: "source",
  name: "Title",
  field_type: "text",
  max_length: null,
  is_required: false,
  is_sortable: true,
  options: [],
  position: 0,
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false } });
  vi.mocked(getInventories).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  queryClient.setDefaultOptions({});
  vi.resetAllMocks();
});

test("keeps the current table mounted until both target queries have loaded", async () => {
  let resolveFields!: (fields: InventoryField[]) => void;
  let resolveItems!: (items: InventoryItem[]) => void;
  const fields = new Promise<InventoryField[]>((resolve) => {
    resolveFields = resolve;
  });
  const items = new Promise<InventoryItem[]>((resolve) => {
    resolveItems = resolve;
  });
  vi.mocked(getInventoryFields).mockImplementation((id) =>
    id === "source" ? Promise.resolve([field]) : fields,
  );
  vi.mocked(getInventoryItems).mockImplementation((id) =>
    id === "source" ? Promise.resolve([]) : items,
  );
  const router = createMemoryRouter(
    [
      {
        path: "/inventories/:inventoryId/items",
        loader: inventoryItemsLoader,
        Component: InventoryItemsPage,
        HydrateFallback: () => null,
      },
    ],
    { initialEntries: ["/inventories/source/items"] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("columnheader", { name: "Title" });
  const currentTable = within(
    screen.getByRole("region", { name: "Inventory items" }),
  ).getByRole("table");
  let navigation!: Promise<void>;
  act(() => {
    navigation = router.navigate("/inventories/target/items");
  });
  await waitFor(() =>
    expect(getInventoryFields).toHaveBeenCalledWith("target"),
  );
  expect(currentTable).toBeVisible();
  expect(screen.queryByText("Loading inventory…")).not.toBeInTheDocument();
  await act(async () => {
    resolveFields([{ ...field, inventory_id: "target", name: "Target title" }]);
  });
  expect(currentTable).toBeVisible();
  expect(
    screen.queryByRole("columnheader", { name: "Target title" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    resolveItems([]);
    await navigation;
  });
  expect(
    screen.getByRole("columnheader", { name: "Target title" }),
  ).toBeVisible();
  expect(currentTable).not.toBeInTheDocument();
  expect(screen.getByText("No items yet.")).toBeVisible();
  expect(screen.queryByText("Loading inventory…")).not.toBeInTheDocument();
  router.dispose();
});

test("uses cached inventory data immediately without fetching in the loader", async () => {
  queryClient.setQueryData(["inventories", "cached", "fields"], [field]);
  queryClient.setQueryData(["inventories", "cached", "items"], []);
  await inventoryItemsLoader({
    params: { inventoryId: "cached" },
  });
  expect(getInventoryFields).not.toHaveBeenCalled();
  expect(getInventoryItems).not.toHaveBeenCalled();
});

test("leaves failed queries available to the page's existing error handling", async () => {
  vi.mocked(getInventoryFields).mockRejectedValueOnce(new Error("Unavailable"));
  vi.mocked(getInventoryItems).mockResolvedValueOnce([]);
  await expect(
    inventoryItemsLoader({
      params: { inventoryId: "failed" },
    }),
  ).resolves.toBeNull();
  expect(
    queryClient.getQueryState(["inventories", "failed", "fields"])?.status,
  ).toBe("error");
});
