import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createInventory, getInventories } from "../services/inventories";
import type { CreateInventoryInput } from "../types/inventory";

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
