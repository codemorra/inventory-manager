import { request } from "./api";

// Represent a persistent single-level inventory group.
export interface InventoryGroup {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/**
 * Load the available inventory groups.
 * @returns Active inventory groups.
 */
export function getInventoryGroups(): Promise<InventoryGroup[]> {
  return request("/inventory-groups");
}

/**
 * Create an inventory group.
 * @param name The group name.
 * @returns The created group.
 */
export function createInventoryGroup(name: string): Promise<InventoryGroup> {
  return request("/inventory-groups", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/**
 * Rename an inventory group.
 * @param id The group identifier.
 * @param name The new name.
 * @returns The updated group.
 */
export function updateInventoryGroup(
  id: string,
  name: string,
): Promise<InventoryGroup> {
  return request(`/inventory-groups/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/**
 * Delete a group without deleting its inventories.
 * @param id The group identifier.
 * @returns Completion of the deletion request.
 */
export function deleteInventoryGroup(id: string): Promise<void> {
  return request(`/inventory-groups/${id}`, { method: "DELETE" });
}
