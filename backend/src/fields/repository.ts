import { and, asc, count, eq, isNull } from "drizzle-orm";
import { inventoryFields } from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";

/**
 * Creates a repository for managing inventory fields.
 * @param db - The application's database connection.
 * @returns An object with methods to list, find, count, create, update, and tombstone inventory fields.
 */
export function createFieldRepository(db: AppDatabase) {
  const activeInventory = (inventoryId: string) =>
    and(
      eq(inventoryFields.inventoryId, inventoryId),
      isNull(inventoryFields.deletedAt),
    );
  const activeField = (inventoryId: string, fieldId: string) =>
    and(activeInventory(inventoryId), eq(inventoryFields.id, fieldId));
  return {
    list: (inventoryId: string) =>
      db
        .select()
        .from(inventoryFields)
        .where(activeInventory(inventoryId))
        .orderBy(asc(inventoryFields.position))
        .all(),
    find: (inventoryId: string, fieldId: string) =>
      db
        .select()
        .from(inventoryFields)
        .where(activeField(inventoryId, fieldId))
        .get(),
    count: (inventoryId: string) =>
      db
        .select({ count: count() })
        .from(inventoryFields)
        .where(activeInventory(inventoryId))
        .get()?.count ?? 0,
    create: (data: typeof inventoryFields.$inferInsert) =>
      db.insert(inventoryFields).values(data).returning().get(),
    update: (
      inventoryId: string,
      fieldId: string,
      changes: {
        name?: string;
        position?: number;
        isRequired?: boolean;
        isSortable?: boolean;
      },
    ) =>
      db
        .update(inventoryFields)
        .set(changes)
        .where(activeField(inventoryId, fieldId))
        .returning()
        .get(),
    tombstone: (inventoryId: string, fieldId: string) =>
      db
        .update(inventoryFields)
        .set({ name: "", deletedAt: new Date().toISOString() })
        .where(activeField(inventoryId, fieldId))
        .run(),
  };
}
