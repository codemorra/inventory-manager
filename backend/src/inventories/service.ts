import type { AppDatabase } from "../db/types.js";
import { DomainError } from "../errors.js";
import { createInventoryRepository } from "./repository.js";
import { inventoryCreateSchema, inventoryUpdateSchema } from "./validation.js";

/**
 * Creates a service for managing inventories.
 * @param db - The application's database connection.
 * @returns An object with methods to get, list, create, update, and delete inventories.
 */
export function createInventoryService(db: AppDatabase) {
  const repository = createInventoryRepository(db);
  function get(id: string) {
    const inventory = repository.find(id);
    if (!inventory)
      throw new DomainError("inventory_not_found", "Inventory not found.");
    return inventory;
  }

  return {
    get,
    list: repository.list,
    create(input: unknown) {
      return repository.create(inventoryCreateSchema.parse(input));
    },
    update(id: string, input: unknown) {
      const data = inventoryUpdateSchema.parse(input);
      const inventory = get(id);
      const changes: { name?: string; description?: string | null } = {};
      if (data.name != null && data.name !== inventory.name)
        changes.name = data.name;
      if (
        data.description !== undefined &&
        data.description !== inventory.description
      )
        changes.description = data.description;
      return Object.keys(changes).length
        ? repository.update(id, changes)
        : inventory;
    },
    delete(id: string) {
      get(id);
      repository.tombstone(id);
    },
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;
