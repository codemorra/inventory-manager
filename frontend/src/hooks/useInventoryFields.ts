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

interface CreateInventoryFieldVariables {
  inventoryId: string;
  data: CreateInventoryFieldInput;
}

interface UpdateInventoryFieldVariables {
  inventoryId: string;
  fieldId: string;
  data: UpdateInventoryFieldInput;
}

interface DeleteInventoryFieldVariables {
  inventoryId: string;
  fieldId: string;
}

function getInventoryFieldsQueryKey(inventoryId: string) {
  return ["inventories", inventoryId, "fields"];
}

export function useInventoryFields(inventoryId: string) {
  return useQuery({
    queryKey: getInventoryFieldsQueryKey(inventoryId),
    queryFn: () => getInventoryFields(inventoryId),
    enabled: Boolean(inventoryId),
  });
}

export function useCreateInventoryField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ inventoryId, data }: CreateInventoryFieldVariables) =>
      createInventoryField(inventoryId, data),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: getInventoryFieldsQueryKey(variables.inventoryId),
      });
    },
  });
}

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
