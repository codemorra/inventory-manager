import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveInventoryConfiguration } from "../services/inventoryEditor";
import type { InventoryEditorInput } from "../types/inventoryEditor";

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
