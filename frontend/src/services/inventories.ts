import { request } from "./api";
import type {
  CreateInventoryInput,
  Inventory,
  UpdateInventoryInput,
} from "../types/inventory";

export function getInventories(): Promise<Inventory[]> {
  return request<Inventory[]>("/inventories");
}

export function createInventory(
  data: CreateInventoryInput,
): Promise<Inventory> {
  return request<Inventory>("/inventories", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateInventory(
  inventoryId: string,
  data: UpdateInventoryInput,
): Promise<Inventory> {
  return request<Inventory>(`/inventories/${inventoryId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteInventory(inventoryId: string): Promise<void> {
  return request<void>(`/inventories/${inventoryId}`, {
    method: "DELETE",
  });
}
