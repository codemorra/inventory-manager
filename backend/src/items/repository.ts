import { and, desc, eq, isNull } from "drizzle-orm";
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
    list: (inventoryId: string) =>
      db
        .select()
        .from(inventoryItems)
        .where(activeInventory(inventoryId))
        .orderBy(desc(inventoryItems.createdAt))
        .all(),
    find: (inventoryId: string, itemId: string) =>
      db
        .select()
        .from(inventoryItems)
        .where(and(activeInventory(inventoryId), eq(inventoryItems.id, itemId)))
        .get(),
    create: (inventoryId: string) =>
      db.insert(inventoryItems).values({ inventoryId }).returning().get(),
    values: (itemId: string) =>
      db.select().from(inventoryItemValues).where(activeValues(itemId)).all(),
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
    tombstoneValues: (itemId: string) =>
      db
        .update(inventoryItemValues)
        .set({ value: null, deletedAt: new Date().toISOString() })
        .where(activeValues(itemId))
        .run(),
    tombstone: (inventoryId: string, itemId: string) =>
      db
        .update(inventoryItems)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(activeInventory(inventoryId), eq(inventoryItems.id, itemId)))
        .run(),
  };
}
