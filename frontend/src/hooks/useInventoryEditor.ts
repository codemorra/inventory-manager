import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  saveInventoryConfiguration,
  getInventoryConfiguration,
} from "../services/inventoryEditor";
import type { InventoryEditorInput } from "../types/inventoryEditor";

/**
 * Load metadata and fields together so the revision always describes the complete editor baseline.
 * @param inventoryId The inventory being opened.
 * @returns The coherent configuration query, independent of the sidebar's inventory cache.
 */
export function useInventoryConfiguration(inventoryId: string) {
  const client = useQueryClient();
  return useQuery({
    queryKey: ["inventories", inventoryId, "configuration"],
    // Reopening starts a fresh session; refetches within a session never replace its draft.
    gcTime: 0,
    queryFn: async () => {
      const result = await getInventoryConfiguration(inventoryId);
      client.setQueryData(
        ["inventories", inventoryId, "fields"],
        result.fields,
      );
      return result;
    },
  });
}

/**
 * Explicitly reload a conflicting configuration without retrying or merging the local draft.
 * @param inventoryId The inventory whose current configuration is requested.
 * @returns The reload mutation; callers decide when to replace their local draft.
 */
export function useReloadInventoryConfiguration(inventoryId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => getInventoryConfiguration(inventoryId),
    onSuccess: (result) => {
      client.setQueryData(
        ["inventories", inventoryId, "configuration"],
        result,
      );
      client.setQueryData(
        ["inventories", inventoryId, "fields"],
        result.fields,
      );
    },
  });
}

/**
 * Persist one editor session and refresh all affected inventory views.
 * @param inventoryId The inventory being edited.
 * @returns The mutation used by the editor's explicit save action.
 */
export function useInventoryEditor(inventoryId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: InventoryEditorInput) =>
      saveInventoryConfiguration(inventoryId, data),
    onSuccess: async (result) => {
      client.setQueryData(
        ["inventories", inventoryId, "fields"],
        result.fields,
      );
      await client.invalidateQueries({ queryKey: ["inventories"] });
    },
  });
}
