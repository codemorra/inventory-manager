import type { AppDatabase } from "../db/types.js";
import { DomainError } from "../errors.js";
import { createInventoryRepository } from "./repository.js";
import { inventoryCreateSchema, inventoryUpdateSchema } from "./validation.js";
import { createGroupService, type GroupService } from "../groups/service.js";
import { tombstoneInventoryContents } from "../db/deletion.js";

/**
 * Creates a service for managing inventories.
 * @param db - The application's database connection.
 * @param groups The group service used to validate inventory membership.
 * @returns An object with methods to get, list, create, update, and delete inventories.
 */
export function createInventoryService(
  db: AppDatabase,
  groups: GroupService = createGroupService(db),
) {
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

    /**
     * Creates a new inventory.
     * @param input The input data for the new inventory.
     * @returns The created inventory.
     */
    create(input: unknown) {
      const data = inventoryCreateSchema.parse(input);
      if (data.group_id != null) groups.get(data.group_id);
      return repository.create({
        name: data.name,
        description: data.description,
        groupId: data.group_id ?? null,
      });
    },

    /**
     * Updates an existing inventory.
     * @param id The ID of the inventory to update.
     * @param input The input data for the update.
     * @returns The updated inventory.
     */
    update(id: string, input: unknown) {
      const data = inventoryUpdateSchema.parse(input);
      const inventory = get(id);
      const changes: {
        name?: string;
        description?: string | null;
        groupId?: string | null;
      } = {};
      if (data.group_id !== undefined && data.group_id !== inventory.groupId) {
        if (data.group_id !== null) groups.get(data.group_id);
        changes.groupId = data.group_id;
      }
      if (data.name != null && data.name !== inventory.name)
        changes.name = data.name;
      if (
        data.description !== undefined &&
        data.description !== inventory.description
      )
        changes.description = data.description;
      if (!Object.keys(changes).length) return inventory;
      repository.update(id, changes);
      // SQLite RETURNING precedes AFTER triggers; reread the final configuration revision.
      return get(id);
    },

    /**
     * Clear an inventory and all dependent content atomically, without deleting its group.
     * @param id The active inventory to delete.
     */
    delete(id: string) {
      get(id);
      db.transaction((transaction) => {
        const deletedAt = new Date().toISOString();
        tombstoneInventoryContents(transaction, id, deletedAt);
        createInventoryRepository(transaction).tombstone(id, deletedAt);
      });
    },
  };
}

export type InventoryService = ReturnType<typeof createInventoryService>;
