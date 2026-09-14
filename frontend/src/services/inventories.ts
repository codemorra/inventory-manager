import { request } from "./api";
import type { Inventory } from "../types/inventory";

export function getInventories(): Promise<Inventory[]> {
  return request<Inventory[]>("/inventories");
}
