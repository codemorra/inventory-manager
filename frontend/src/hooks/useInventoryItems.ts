import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createInventoryItem,
  deleteInventoryItem,
  getInventoryItems,
  updateInventoryItem,
} from "../services/inventoryItems";
import type {
  InventoryItemInput,
  UpdateInventoryItemInput,
} from "../types/inventoryItem";

/** Define mutation variables for inventory item creation. */
interface CreateInventoryItemVariables {
  inventoryId: string;
  data: InventoryItemInput;
}

/** Define mutation variables for inventory item updates. */
interface UpdateInventoryItemVariables {
  inventoryId: string;
  itemId: string;
  data: UpdateInventoryItemInput;
}

/** Define mutation variables for inventory item deletion. */
interface DeleteInventoryItemVariables {
  inventoryId: string;
  itemId: string;
  expectedRevision: number;
}

/** Return the item query key scoped to a single inventory. */
function getInventoryItemsQueryKey(inventoryId: string) {
  return ["inventories", inventoryId, "items"];
}

/** Retrieve active items for an inventory. */
export function useInventoryItems(inventoryId: string) {
  return useQuery({
    queryKey: getInventoryItemsQueryKey(inventoryId),
    queryFn: () => getInventoryItems(inventoryId),
    enabled: Boolean(inventoryId),
  });
}

/** Create an inventory item and refresh its item list. */
export function useCreateInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ inventoryId, data }: CreateInventoryItemVariables) =>
      createInventoryItem(inventoryId, data),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getInventoryItemsQueryKey(variables.inventoryId),
      });
    },
  });
}

/** Replace an inventory item's values and refresh its item list. */
export function useUpdateInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ inventoryId, itemId, data }: UpdateInventoryItemVariables) =>
      updateInventoryItem(inventoryId, itemId, data),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getInventoryItemsQueryKey(variables.inventoryId),
      });
    },
  });
}

/** Delete an inventory item and refresh its item list. */
export function useDeleteInventoryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      inventoryId,
      itemId,
      expectedRevision,
    }: DeleteInventoryItemVariables) =>
      deleteInventoryItem(inventoryId, itemId, expectedRevision),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getInventoryItemsQueryKey(variables.inventoryId),
      });
    },
  });
}

/**
 * Explicitly reload current entries after a conflict without automatically resubmitting a stale draft.
 * @returns A refresh mutation that updates the inventory's item query cache.
 */
export function useReloadInventoryItems() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (inventoryId: string) => getInventoryItems(inventoryId),
    onSuccess: (items, inventoryId) => {
      client.setQueryData(getInventoryItemsQueryKey(inventoryId), items);
    },
  });
}
