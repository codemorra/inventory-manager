import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getInventoryTemplates,
  instantiateInventoryTemplate,
  saveInventoryTemplate,
  getInventoryTemplate,
  updateInventoryTemplate,
  deleteInventoryTemplate,
} from "../services/inventoryTemplates";
import type {
  InstantiateInventoryTemplateInput,
  SaveInventoryTemplateInput,
  UpdateInventoryTemplateInput,
} from "../types/inventoryTemplate";

// Mount this query only where templates are actually being selected or managed.
export function useInventoryTemplates() {
  return useQuery({
    queryKey: ["inventory-templates"],
    queryFn: getInventoryTemplates,
  });
}

/**
 * Load a fresh editor baseline; background refreshes never replace the editor's local state.
 * @param id The template being opened.
 * @returns The complete-template query.
 */
export function useInventoryTemplate(id: string) {
  return useQuery({
    queryKey: ["inventory-templates", id],
    queryFn: () => getInventoryTemplate(id),
    gcTime: 0,
  });
}

/**
 * Save a template draft without invalidating any generated inventory.
 * @param id The template being edited.
 * @returns The revision-checked update mutation.
 */
export function useUpdateInventoryTemplate(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateInventoryTemplateInput) =>
      updateInventoryTemplate(id, data),
    retry: false,
    onSuccess: (result) => {
      client.setQueryData(["inventory-templates", id], result);
      void client.invalidateQueries({
        queryKey: ["inventory-templates"],
        exact: true,
      });
    },
  });
}

// Deletion refreshes only templates; existing inventories remain independent.
export function useDeleteInventoryTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) =>
      deleteInventoryTemplate(id, revision),
    retry: false,
    onSuccess: (_, { id }) => {
      client.removeQueries({
        queryKey: ["inventory-templates", id],
        exact: true,
      });
      void client.invalidateQueries({
        queryKey: ["inventory-templates"],
        exact: true,
      });
    },
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
