import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createInventoryItem,
  deleteInventoryItem,
  getInventoryItems,
  updateInventoryItem,
} from "../services/inventoryItems";
import type { InventoryItemInput } from "../types/inventoryItem";

/** Define mutation variables for inventory item creation. */
interface CreateInventoryItemVariables {
  inventoryId: string;
  data: InventoryItemInput;
}

/** Define mutation variables for inventory item updates. */
interface UpdateInventoryItemVariables {
  inventoryId: string;
  itemId: string;
  data: InventoryItemInput;
}

/** Define mutation variables for inventory item deletion. */
interface DeleteInventoryItemVariables {
  inventoryId: string;
  itemId: string;
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
    mutationFn: ({ inventoryId, itemId }: DeleteInventoryItemVariables) =>
      deleteInventoryItem(inventoryId, itemId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getInventoryItemsQueryKey(variables.inventoryId),
      });
    },
  });
}
