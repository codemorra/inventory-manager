import { request } from "./api";
import type {
  CreateInventoryInput,
  Inventory,
  UpdateInventoryInput,
} from "../types/inventory";

/** Retrieve all active inventories. */
export function getInventories(): Promise<Inventory[]> {
  return request<Inventory[]>("/inventories");
}

/**
 * Create an inventory.
 *
 * @param data - Inventory creation data.
 * @returns Created inventory.
 */
export function createInventory(
  data: CreateInventoryInput,
): Promise<Inventory> {
  return request<Inventory>("/inventories", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Update an inventory.
 *
 * @param inventoryId - Inventory identifier.
 * @param data - Inventory update data.
 * @returns Updated inventory.
 */
export function updateInventory(
  inventoryId: string,
  data: UpdateInventoryInput,
): Promise<Inventory> {
  return request<Inventory>(`/inventories/${inventoryId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Delete an inventory by identifier.
 *
 * @param inventoryId - Inventory identifier.
 * @returns Completion of the deletion request.
 */
export function deleteInventory(inventoryId: string): Promise<void> {
  return request<void>(`/inventories/${inventoryId}`, {
    method: "DELETE",
  });
}
