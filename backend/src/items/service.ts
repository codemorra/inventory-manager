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
    read(inventoryId: string, itemId: string) {
      return { ...get(inventoryId, itemId), values: repository.values(itemId) };
    },
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
    create(inventoryId: string, input: unknown) {
      const data = itemInputSchema.parse(input);
      inventories.get(inventoryId);
      return db.transaction((transaction) => {
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
    update(inventoryId: string, itemId: string, input: unknown) {
      const data = itemInputSchema.parse(input);
      const item = get(inventoryId, itemId);
      return db.transaction((transaction) => {
        validate(transaction, inventoryId, data.values);
        const items = createItemRepository(transaction);
        // Full replacement applies to editable values, never to server-owned ID assignments.
        const automaticFields = createFieldRepository(transaction)
          .list(inventoryId)
          .filter((field) => field.fieldType === "id")
          .map((field) => field.id);
        items.tombstoneValues(item.id, automaticFields);
        items.createValues(item.id, data.values);
        // Replacing values deliberately does not update the item's own lifecycle timestamp.
        return { ...item, values: items.values(item.id) };
      });
    },
    delete(inventoryId: string, itemId: string) {
      get(inventoryId, itemId);
      db.transaction((transaction) => {
        const items = createItemRepository(transaction);
        items.tombstone(inventoryId, itemId);
        items.tombstoneValues(itemId);
      });
    },
  };
}
