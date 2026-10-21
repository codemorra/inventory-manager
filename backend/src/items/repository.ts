import { and, desc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { inventoryItems, inventoryItemValues } from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";
import type { ValueInput } from "./validation.js";

/**
 * Creates a repository for managing inventory items and their values.
 * @param db The database instance to use for queries.
 * @returns An object with methods for listing, finding, creating, and tombstoning items and their values.
 */
export function createItemRepository(db: AppDatabase) {
  const activeInventory = (inventoryId: string) =>
    and(
      eq(inventoryItems.inventoryId, inventoryId),
      isNull(inventoryItems.deletedAt),
    );
  const activeValues = (itemId: string) =>
    and(
      eq(inventoryItemValues.itemId, itemId),
      isNull(inventoryItemValues.deletedAt),
    );
  return {
    /**
     * Lists all inventory items for a given inventory.
     * @param inventoryId The ID of the inventory.
     * @returns The list of inventory items.
     */
    list: (inventoryId: string) =>
      db
        .select()
        .from(inventoryItems)
        .where(activeInventory(inventoryId))
        .orderBy(desc(inventoryItems.createdAt))
        .all(),

    /**
     * Finds an inventory item by its ID within a given inventory.
     * @param inventoryId The ID of the inventory.
     * @param itemId The ID of the item.
     * @returns The inventory item, or undefined if not found.
     */
    find: (inventoryId: string, itemId: string) =>
      db
        .select()
        .from(inventoryItems)
        .where(and(activeInventory(inventoryId), eq(inventoryItems.id, itemId)))
        .get(),

    /**
     * Creates a new inventory item within a given inventory.
     * @param inventoryId The ID of the inventory.
     * @returns The created inventory item.
     */
    create: (inventoryId: string) =>
      db.insert(inventoryItems).values({ inventoryId }).returning().get(),

    /**
     * Claim the next revision before modifying values inside the caller's transaction.
     * @param inventoryId The parent inventory identifier.
     * @param itemId The item whose saved revision must still match.
     * @param expectedRevision The revision read by the editing client.
     * @returns The updated item, or undefined if the revision no longer matches.
     */
    claimRevision: (
      inventoryId: string,
      itemId: string,
      expectedRevision: number,
    ) =>
      db
        .update(inventoryItems)
        .set({ revision: sql`${inventoryItems.revision} + 1` })
        .where(
          and(
            activeInventory(inventoryId),
            eq(inventoryItems.id, itemId),
            eq(inventoryItems.revision, expectedRevision),
            sql`${inventoryItems.revision} < ${Number.MAX_SAFE_INTEGER}`,
          ),
        )
        .returning()
        .get(),

    /**
     * Retrieves all values for a given inventory item.
     * @param itemId The ID of the inventory item.
     * @returns The list of values for the item.
     */
    values: (itemId: string) =>
      db.select().from(inventoryItemValues).where(activeValues(itemId)).all(),

    /**
     * Retrieves all values for a given inventory within an inventory.
     * @param inventoryId The ID of the inventory.
     * @returns The list of values for the inventory.
     */
    valuesForInventory: (inventoryId: string) =>
      db
        .select({ value: inventoryItemValues })
        .from(inventoryItemValues)
        .innerJoin(
          inventoryItems,
          eq(inventoryItems.id, inventoryItemValues.itemId),
        )
        .where(
          and(
            activeInventory(inventoryId),
            isNull(inventoryItemValues.deletedAt),
          ),
        )
        .all()
        .map((row) => row.value),

    /**
     * Creates multiple values for a given inventory item.
     * @param itemId The ID of the inventory item.
     * @param values The values to create.
     */
    createValues(itemId: string, values: ValueInput[]) {
      // Keep large replacement sets below SQLite's bind-parameter limit within the caller's transaction.
      for (let start = 0; start < values.length; start += 500) {
        db.insert(inventoryItemValues)
          .values(
            values.slice(start, start + 500).map((input) => ({
              itemId,
              fieldId: input.field_id,
              value: input.value,
            })),
          )
          .run();
      }
    },

    /**
     * Tombstones (soft-deletes) values for a given inventory item, preserving specified fields.
     * @param itemId The ID of the inventory item.
     * @param preservedFields The fields to preserve.
     * @param deletedAt The timestamp of deletion.
     */
    tombstoneValues: (
      itemId: string,
      preservedFields: string[] = [],
      deletedAt = new Date().toISOString(),
    ) =>
      db
        .update(inventoryItemValues)
        .set({ value: null, deletedAt, updatedAt: deletedAt })
        .where(
          and(
            activeValues(itemId),
            preservedFields.length
              ? notInArray(inventoryItemValues.fieldId, preservedFields)
              : undefined,
          ),
        )
        .run(),

    /**
     * Tombstones (soft-deletes) an inventory item.
     * @param inventoryId The ID of the inventory.
     * @param itemId The ID of the inventory item.
     * @param deletedAt The timestamp of deletion.
     */
    tombstone: (
      inventoryId: string,
      itemId: string,
      deletedAt = new Date().toISOString(),
    ) =>
      db
        .update(inventoryItems)
        .set({ deletedAt, updatedAt: deletedAt })
        .where(and(activeInventory(inventoryId), eq(inventoryItems.id, itemId)))
        .run(),
  };
}
