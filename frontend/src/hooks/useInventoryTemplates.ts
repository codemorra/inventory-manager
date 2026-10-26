import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getInventoryTemplates,
  instantiateInventoryTemplate,
  saveInventoryTemplate,
} from "../services/inventoryTemplates";
import type {
  InstantiateInventoryTemplateInput,
  SaveInventoryTemplateInput,
} from "../types/inventoryTemplate";

// Mount this query only where templates are actually being selected or managed.
export function useInventoryTemplates() {
  return useQuery({
    queryKey: ["inventory-templates"],
    queryFn: getInventoryTemplates,
  });
}

// Saving a blueprint does not modify or invalidate its source inventory configuration.
export function useSaveInventoryTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: SaveInventoryTemplateInput) =>
      saveInventoryTemplate(data),
    retry: false,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["inventory-templates"] });
    },
  });
}

// Seed the new inventory's coherent configuration before navigation, then refresh the sidebar.
export function useInstantiateInventoryTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: InstantiateInventoryTemplateInput;
    }) => instantiateInventoryTemplate(id, data),
    retry: false,
    onSuccess: async (result) => {
      client.setQueryData(
        ["inventories", result.inventory.id, "configuration"],
        result,
      );
      client.setQueryData(
        ["inventories", result.inventory.id, "fields"],
        result.fields,
      );
      client.setQueryData(["inventories", result.inventory.id, "items"], []);
      await client.invalidateQueries({
        queryKey: ["inventories"],
        exact: true,
      });
    },
  });
}
