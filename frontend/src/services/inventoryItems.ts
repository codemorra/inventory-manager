import { request } from "./api";
import type {
  InventoryItem,
  InventoryItemInput,
  UpdateInventoryItemInput,
  UpdateInventoryItemsInput,
} from "../types/inventoryItem";

/**
 * Retrieve active items for an inventory.
 *
 * @param inventoryId - Parent inventory identifier.
 * @returns Active inventory items.
 */
export function getInventoryItems(
  inventoryId: string,
): Promise<InventoryItem[]> {
  return request<InventoryItem[]>(`/inventories/${inventoryId}/items`);
}

/**
 * Create an inventory item from typed field values.
 *
 * @param inventoryId - Parent inventory identifier.
 * @param data - Inventory item creation data.
 * @returns Created inventory item.
 */
export function createInventoryItem(
  inventoryId: string,
  data: InventoryItemInput,
): Promise<InventoryItem> {
  return request<InventoryItem>(`/inventories/${inventoryId}/items`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Replace all values of an inventory item.
 *
 * @param inventoryId - Parent inventory identifier.
 * @param itemId - Inventory item identifier.
 * @param data - Complete replacement item values.
 * @returns Updated inventory item.
 */
export function updateInventoryItem(
  inventoryId: string,
  itemId: string,
  data: UpdateInventoryItemInput,
): Promise<InventoryItem> {
  return request<InventoryItem>(`/inventories/${inventoryId}/items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Save changed table rows in one atomic request without retrying stale snapshots.
 * @param inventoryId The inventory containing every submitted row.
 * @param data Complete changed-row replacements and their original versions.
 * @returns Saved items in request order with new revisions.
 */
export function updateInventoryItems(
  inventoryId: string,
  data: UpdateInventoryItemsInput,
): Promise<InventoryItem[]> {
  return request(`/inventories/${inventoryId}/items`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Delete an inventory item by identifier.
 *
 * @param inventoryId - Parent inventory identifier.
 * @param itemId - Inventory item identifier.
 * @param expectedRevision - Revision captured when deletion was requested.
 * @returns Completion of the deletion request.
 */
export function deleteInventoryItem(
  inventoryId: string,
  itemId: string,
  expectedRevision: number,
): Promise<void> {
  return request<void>(`/inventories/${inventoryId}/items/${itemId}`, {
    method: "DELETE",
    body: JSON.stringify({ expected_revision: expectedRevision }),
  });
}
