import { request } from "./api";
import type {
  CreateInventoryFieldInput,
  InventoryField,
  UpdateInventoryFieldInput,
} from "../types/inventoryField";

export function getInventoryFields(
  inventoryId: string,
): Promise<InventoryField[]> {
  return request<InventoryField[]>(`/inventories/${inventoryId}/fields`);
}

export function createInventoryField(
  inventoryId: string,
  data: CreateInventoryFieldInput,
): Promise<InventoryField> {
  return request<InventoryField>(`/inventories/${inventoryId}/fields`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateInventoryField(
  inventoryId: string,
  fieldId: string,
  data: UpdateInventoryFieldInput,
): Promise<InventoryField> {
  return request<InventoryField>(
    `/inventories/${inventoryId}/fields/${fieldId}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );
}

export function deleteInventoryField(
  inventoryId: string,
  fieldId: string,
): Promise<void> {
  return request<void>(`/inventories/${inventoryId}/fields/${fieldId}`, {
    method: "DELETE",
  });
}
