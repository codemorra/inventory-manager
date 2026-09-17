/** Manage inventory field queries and mutations. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createInventoryField,
  createInventoryFieldOption,
  deleteInventoryField,
  deleteInventoryFieldOption,
  getInventoryFields,
  updateInventoryField,
  updateInventoryFieldOption,
} from "../services/inventoryFields";
import type {
  CreateInventoryFieldInput,
  CreateInventoryFieldOptionInput,
  UpdateInventoryFieldInput,
  UpdateInventoryFieldOptionInput,
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

interface CreateInventoryFieldOptionVariables {
  inventoryId: string;
  fieldId: string;
  data: CreateInventoryFieldOptionInput;
}

interface UpdateInventoryFieldOptionVariables {
  inventoryId: string;
  fieldId: string;
  optionId: string;
  data: UpdateInventoryFieldOptionInput;
}

interface DeleteInventoryFieldOptionVariables {
  inventoryId: string;
  fieldId: string;
  optionId: string;
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

export function useCreateInventoryFieldOption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      inventoryId,
      fieldId,
      data,
    }: CreateInventoryFieldOptionVariables) =>
      createInventoryFieldOption(inventoryId, fieldId, data),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getInventoryFieldsQueryKey(variables.inventoryId),
      });
    },
  });
}

export function useUpdateInventoryFieldOption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      inventoryId,
      fieldId,
      optionId,
      data,
    }: UpdateInventoryFieldOptionVariables) =>
      updateInventoryFieldOption(inventoryId, fieldId, optionId, data),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getInventoryFieldsQueryKey(variables.inventoryId),
      });
    },
  });
}

export function useDeleteInventoryFieldOption() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      inventoryId,
      fieldId,
      optionId,
    }: DeleteInventoryFieldOptionVariables) =>
      deleteInventoryFieldOption(inventoryId, fieldId, optionId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getInventoryFieldsQueryKey(variables.inventoryId),
      });
    },
  });
}
