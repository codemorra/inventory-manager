import { request } from "./api";
import type { CreateInventoryInput, Inventory } from "../types/inventory";

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
