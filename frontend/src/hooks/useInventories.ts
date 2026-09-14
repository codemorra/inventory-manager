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

interface UpdateInventoryVariables {
  inventoryId: string;
  data: UpdateInventoryInput;
}

export function useInventories() {
  return useQuery({
    queryKey: ["inventories"],
    queryFn: getInventories,
  });
}

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
