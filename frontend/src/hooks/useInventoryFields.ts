/** Manage inventory field queries and mutations. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createInventoryField,
  deleteInventoryField,
  getInventoryFields,
  updateInventoryField,
} from "../services/inventoryFields";
import type {
  CreateInventoryFieldInput,
  UpdateInventoryFieldInput,
} from "../types/inventoryField";

/** Define mutation variables for inventory field creation. */
interface CreateInventoryFieldVariables {
  inventoryId: string;
  data: CreateInventoryFieldInput;
}

/** Define mutation variables for inventory field updates. */
interface UpdateInventoryFieldVariables {
  inventoryId: string;
  fieldId: string;
  data: UpdateInventoryFieldInput;
}

/** Define mutation variables for inventory field deletion. */
interface DeleteInventoryFieldVariables {
  inventoryId: string;
  fieldId: string;
}

/** Return the query key scoped to a single inventory. */
function getInventoryFieldsQueryKey(inventoryId: string) {
  return ["inventories", inventoryId, "fields"];
}

/** Retrieve active fields for an inventory. */
export function useInventoryFields(inventoryId: string) {
  return useQuery({
    queryKey: getInventoryFieldsQueryKey(inventoryId),
    queryFn: () => getInventoryFields(inventoryId),
    enabled: Boolean(inventoryId),
  });
}

/** Create an inventory field and refresh its field list. */
export function useCreateInventoryField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ inventoryId, data }: CreateInventoryFieldVariables) =>
      createInventoryField(inventoryId, data),
    onSuccess: async (_, variables) => {
      // Only the affected inventory field list needs to be refreshed.
      await queryClient.invalidateQueries({
        queryKey: getInventoryFieldsQueryKey(variables.inventoryId),
      });
    },
  });
}

/** Update an inventory field and refresh its field list. */
export function useUpdateInventoryField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      inventoryId,
      fieldId,
      data,
    }: UpdateInventoryFieldVariables) =>
      updateInventoryField(inventoryId, fieldId, data),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getInventoryFieldsQueryKey(variables.inventoryId),
      });
    },
  });
}

/** Delete an inventory field and refresh its field list. */
export function useDeleteInventoryField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ inventoryId, fieldId }: DeleteInventoryFieldVariables) =>
      deleteInventoryField(inventoryId, fieldId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getInventoryFieldsQueryKey(variables.inventoryId),
      });
    },
  });
}
