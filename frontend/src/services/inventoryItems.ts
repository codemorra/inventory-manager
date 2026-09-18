/** Send requests for inventory item data. */
import { request } from "./api";
import type { InventoryItem, InventoryItemInput } from "../types/inventoryItem";

export function getInventoryItems(inventoryId: string): Promise<InventoryItem[]> { return request(`/inventories/${inventoryId}/items`); }
export function createInventoryItem(inventoryId: string, data: InventoryItemInput): Promise<InventoryItem> { return request(`/inventories/${inventoryId}/items`, { method: "POST", body: JSON.stringify(data) }); }
export function updateInventoryItem(inventoryId: string, itemId: string, data: InventoryItemInput): Promise<InventoryItem> { return request(`/inventories/${inventoryId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }); }
export function deleteInventoryItem(inventoryId: string, itemId: string): Promise<void> { return request(`/inventories/${inventoryId}/items/${itemId}`, { method: "DELETE" }); }
