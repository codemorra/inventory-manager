import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { useUpdateInventoryItem } from "../../src/hooks/useInventoryItems";
import { updateInventoryItem } from "../../src/services/inventoryItems";
import type { InventoryItem } from "../../src/types/inventoryItem";

vi.mock("../../src/services/inventoryItems", () => ({
  createInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
  getInventoryItems: vi.fn(),
  updateInventoryItem: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const item: InventoryItem = {
  id: "item-1",
  inventory_id: "inventory-1",
  revision: 1,
  values: [],
  created_at: "2026-10-31T10:00:00Z",
  updated_at: "2026-10-31T10:00:00Z",
};
const key = ["inventories", item.inventory_id, "items"];
const variables = {
  inventoryId: item.inventory_id,
  itemId: item.id,
  data: { expected_revision: 1, values: [] },
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const sibling = { ...item, id: "item-2" };
  client.setQueryData(key, [item, sibling]);
  client.setQueryData(["inventories", "other", "items"], [sibling]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    sibling,
    ...renderHook(() => useUpdateInventoryItem(), { wrapper }),
  };
}

test("caches the saved item and revision without reloading the inventory", async () => {
  const saved = { ...item, revision: 2, updated_at: "2026-10-31T10:01:00Z" };
  vi.mocked(updateInventoryItem).mockResolvedValueOnce(saved);
  const { client, sibling, result } = setup();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await act(async () => {
    await result.current.mutateAsync(variables);
  });
  expect(client.getQueryData(key)).toEqual([saved, sibling]);
  expect(client.getQueryData(["inventories", "other", "items"])).toEqual([
    sibling,
  ]);
  expect(invalidate).not.toHaveBeenCalled();
});

test("keeps cached values and revisions intact when saving fails", async () => {
  vi.mocked(updateInventoryItem).mockRejectedValueOnce(new Error("Conflict"));
  const { client, sibling, result } = setup();
  await act(async () => {
    await expect(result.current.mutateAsync(variables)).rejects.toThrow(
      "Conflict",
    );
  });
  expect(client.getQueryData(key)).toEqual([item, sibling]);
});
