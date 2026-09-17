/** Send requests for inventory field data. */
import { request } from "./api";
import type {
  CreateInventoryFieldInput,
  CreateInventoryFieldOptionInput,
  InventoryField,
  InventoryFieldOption,
  UpdateInventoryFieldInput,
  UpdateInventoryFieldOptionInput,
} from "../types/inventoryField";

/**
 * Retrieve active fields for an inventory.
 *
 * @param inventoryId - Parent inventory identifier.
 * @returns Active inventory fields.
 */
export function getInventoryFields(
  inventoryId: string,
): Promise<InventoryField[]> {
  return request<InventoryField[]>(`/inventories/${inventoryId}/fields`);
}

/**
 * Create an inventory field.
 *
 * @param inventoryId - Parent inventory identifier.
 * @param data - Inventory field creation data.
 * @returns Created inventory field.
 */
export function createInventoryField(
  inventoryId: string,
  data: CreateInventoryFieldInput,
): Promise<InventoryField> {
  return request<InventoryField>(`/inventories/${inventoryId}/fields`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Update an inventory field.
 *
 * @param inventoryId - Parent inventory identifier.
 * @param fieldId - Inventory field identifier.
 * @param data - Inventory field update data.
 * @returns Updated inventory field.
 */
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

/**
 * Delete an inventory field by identifier.
 *
 * @param inventoryId - Parent inventory identifier.
 * @param fieldId - Inventory field identifier.
 * @returns Completion of the deletion request.
 */
export function deleteInventoryField(
  inventoryId: string,
  fieldId: string,
): Promise<void> {
  return request<void>(`/inventories/${inventoryId}/fields/${fieldId}`, {
    method: "DELETE",
  });
}

/** Retrieve active options for an inventory field. */
export function getInventoryFieldOptions(
  inventoryId: string,
  fieldId: string,
): Promise<InventoryFieldOption[]> {
  return request<InventoryFieldOption[]>(
    `/inventories/${inventoryId}/fields/${fieldId}/options`,
  );
}

/** Create an option for a selectable inventory field. */
export function createInventoryFieldOption(
  inventoryId: string,
  fieldId: string,
  data: CreateInventoryFieldOptionInput,
): Promise<InventoryFieldOption> {
  return request<InventoryFieldOption>(
    `/inventories/${inventoryId}/fields/${fieldId}/options`,
    {
      method: "POST",
      body: JSON.stringify(data),
    },
  );
}

/** Update an inventory field option. */
export function updateInventoryFieldOption(
  inventoryId: string,
  fieldId: string,
  optionId: string,
  data: UpdateInventoryFieldOptionInput,
): Promise<InventoryFieldOption> {
  return request<InventoryFieldOption>(
    `/inventories/${inventoryId}/fields/${fieldId}/options/${optionId}`,
    {
      method: "PATCH",
      body: JSON.stringify(data),
    },
  );
}

/** Delete an inventory field option by identifier. */
export function deleteInventoryFieldOption(
  inventoryId: string,
  fieldId: string,
  optionId: string,
): Promise<void> {
  return request<void>(
    `/inventories/${inventoryId}/fields/${fieldId}/options/${optionId}`,
    {
      method: "DELETE",
    },
  );
}
