import type { inventoryItemValues } from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";
import { DomainError } from "../errors.js";
import { createFieldRepository } from "../fields/repository.js";
import type { InventoryService } from "../inventories/service.js";
import { createOptionRepository } from "../options/repository.js";
import { createItemRepository } from "./repository.js";
import { assignAutomaticId } from "./automatic-ids.js";
import {
  itemInputSchema,
  itemUpdateSchema,
  itemRevisionSchema,
  validateValues,
  type ValueInput,
} from "./validation.js";

/**
 * Creates a service for managing inventory items and their values.
 * @param db The database instance to use for queries.
 * @param inventories The inventory service to use for inventory-related checks.
 * @returns An object with methods for getting, reading, listing, creating, updating, and deleting inventory items.
 */
export function createItemService(
  db: AppDatabase,
  inventories: InventoryService,
) {
  const repository = createItemRepository(db);
  function get(inventoryId: string, itemId: string) {
    inventories.get(inventoryId);
    const item = repository.find(inventoryId, itemId);
    if (!item)
      throw new DomainError(
        "inventory_item_not_found",
        "Inventory item not found.",
      );
    return item;
  }

  /**
   * Validates the provided values against the inventory's field definitions and options.
   * @param transaction The database transaction to use for queries.
   * @param inventoryId The ID of the inventory to validate against.
   * @param values The values to validate.
   * @throws {DomainError} If any of the values are invalid.
   */
  function validate(
    transaction: AppDatabase,
    inventoryId: string,
    values: ValueInput[],
  ) {
    const fields = createFieldRepository(transaction).list(inventoryId);
    const selectable = fields.filter(
      (field) =>
        field.fieldType === "select" || field.fieldType === "multiselect",
    );
    const options = createOptionRepository(transaction).listForFields(
      selectable.map((field) => field.id),
    );
    validateValues(values, fields, options);
  }

  return {
    get,

    /**
     * Retrieves an inventory item by its ID within a given inventory.
     * @param inventoryId The ID of the inventory.
     * @param itemId The ID of the item.
     * @returns The inventory item.
     */
    read(inventoryId: string, itemId: string) {
      return { ...get(inventoryId, itemId), values: repository.values(itemId) };
    },

    /**
     * Lists all inventory items for a given inventory along with their values.
     * @param inventoryId The ID of the inventory.
     * @returns The list of inventory items with their values.
     */
    list(inventoryId: string) {
      inventories.get(inventoryId);
      const items = repository.list(inventoryId);
      const grouped = new Map<
        string,
        (typeof inventoryItemValues.$inferSelect)[]
      >();
      if (items.length) {
        for (const value of repository.valuesForInventory(inventoryId)) {
          const group = grouped.get(value.itemId) ?? [];
          group.push(value);
          grouped.set(value.itemId, group);
        }
      }
      return items.map((item) => ({
        ...item,
        values: grouped.get(item.id) ?? [],
      }));
    },

    /**
     * Creates a new inventory item within a given inventory.
     * @param inventoryId The ID of the inventory.
     * @param input The input data for the new item.
     * @returns The created inventory item with its values.
     */
    create(inventoryId: string, input: unknown) {
      const data = itemInputSchema.parse(input);
      return db.transaction((transaction) => {
        inventories.get(inventoryId);
        validate(transaction, inventoryId, data.values);
        const items = createItemRepository(transaction);
        const item = items.create(inventoryId);
        items.createValues(item.id, data.values);
        for (const field of createFieldRepository(transaction).list(
          inventoryId,
        ))
          if (field.fieldType === "id")
            assignAutomaticId(transaction, field.id, item.id);
        return { ...item, values: items.values(item.id) };
      });
    },

    /**
     * Replace editable values only while the caller's saved revision still matches.
     * @param inventoryId The parent inventory identifier.
     * @param itemId The item being edited.
     * @param input Complete replacement values and the required expected_revision.
     * @returns The saved item with its incremented revision and preserved automatic IDs.
     * @throws DomainError if the item is missing, stale, or contains invalid values.
     */
    update(inventoryId: string, itemId: string, input: unknown) {
      const data = itemUpdateSchema.parse(input);
      return db.transaction((transaction) => {
        get(inventoryId, itemId);
        const items = createItemRepository(transaction);
        // Compare-and-swap and value replacement share a transaction, including all rollback paths.
        const item = items.claimRevision(
          inventoryId,
          itemId,
          data.expected_revision,
        );
        if (!item)
          throw new DomainError(
            "inventory_item_conflict",
            "The inventory item has changed. Reload it before saving.",
          );
        validate(transaction, inventoryId, data.values);
        // Full replacement applies to editable values, never to server-owned ID assignments.
        const automaticFields = createFieldRepository(transaction)
          .list(inventoryId)
          .filter((field) => field.fieldType === "id")
          .map((field) => field.id);
        items.tombstoneValues(item.id, automaticFields);
        items.createValues(item.id, data.values);
        return { ...item, values: items.values(item.id) };
      });
    },

    /**
     * Delete the confirmed item snapshot and its content without overwriting a newer edit.
     * @param inventoryId The parent inventory identifier.
     * @param itemId The item selected for deletion.
     * @param input The required expected_revision captured when confirmation opened.
     * @throws DomainError if the item no longer exists or its revision has changed.
     */
    delete(inventoryId: string, itemId: string, input: unknown) {
      const data = itemRevisionSchema.parse(input);
      db.transaction((transaction) => {
        get(inventoryId, itemId);
        const items = createItemRepository(transaction);
        if (!items.claimRevision(inventoryId, itemId, data.expected_revision))
          throw new DomainError(
            "inventory_item_conflict",
            "The inventory item has changed. Reload it before deleting.",
          );
        const deletedAt = new Date().toISOString();
        items.tombstone(inventoryId, itemId, deletedAt);
        items.tombstoneValues(itemId, [], deletedAt);
      });
    },
  };
}
