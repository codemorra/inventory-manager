import { request } from "./api";
import type {
  InventoryEditorInput,
  InventoryEditorResult,
} from "../types/inventoryEditor";

/**
 * Read a coherent editor snapshot, including its revision, field definitions, and options.
 * @param inventoryId The active inventory to edit.
 * @returns Metadata and fields from the same database transaction.
 */
export function getInventoryConfiguration(
  inventoryId: string,
): Promise<InventoryEditorResult> {
  return request(`/inventories/${inventoryId}/configuration`);
}

/**
 * Save an inventory editor draft in one atomic request.
 * @param inventoryId The inventory being edited.
 * @param data The metadata and field or option changes.
 * @returns The saved inventory and its active field configuration.
 */
export function saveInventoryConfiguration(
  inventoryId: string,
  data: InventoryEditorInput,
): Promise<InventoryEditorResult> {
  return request(`/inventories/${inventoryId}/configuration`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
