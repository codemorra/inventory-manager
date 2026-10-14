import { request } from "./api";
import type {
  InventoryEditorInput,
  InventoryEditorResult,
} from "../types/inventoryEditor";

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
