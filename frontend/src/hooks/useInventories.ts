import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createInventory,
  deleteInventory,
  getInventories,
  updateInventory,
} from "../services/inventories";
import type {
  CreateInventoryInput,
  UpdateInventoryInput,
} from "../types/inventory";

/** Define mutation variables for an inventory update. */
interface UpdateInventoryVariables {
  inventoryId: string;
  data: UpdateInventoryInput;
}

/** Retrieve the active inventory list. */
export function useInventories() {
  return useQuery({
    queryKey: ["inventories"],
    queryFn: getInventories,
  });
}

/** Create an inventory and refresh the inventory list. */
export function useCreateInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateInventoryInput) => createInventory(data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["inventories"],
      });
    },
  });
}

/** Update an inventory and refresh the inventory list. */
export function useUpdateInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ inventoryId, data }: UpdateInventoryVariables) =>
      updateInventory(inventoryId, data),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["inventories"],
      });
    },
  });
}

/** Delete an inventory and refresh the inventory list. */
export function useDeleteInventory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (inventoryId: string) => deleteInventory(inventoryId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["inventories"],
      });
    },
  });
}
