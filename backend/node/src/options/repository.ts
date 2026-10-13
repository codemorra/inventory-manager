import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { inventoryFieldOptions } from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";

/**
 * Creates a repository for managing inventory field options.
 * @param db - The application's database connection.
 * @returns An object with methods to list, find, count, create, rename, and tombstone options.
 */
export function createOptionRepository(db: AppDatabase) {
  const activeField = (fieldId: string) =>
    and(
      eq(inventoryFieldOptions.fieldId, fieldId),
      isNull(inventoryFieldOptions.deletedAt),
    );
  const activeOption = (fieldId: string, optionId: string) =>
    and(activeField(fieldId), eq(inventoryFieldOptions.id, optionId));
  return {
    list: (fieldId: string) =>
      db
        .select()
        .from(inventoryFieldOptions)
        .where(activeField(fieldId))
        .orderBy(asc(inventoryFieldOptions.position))
        .all(),
    listForFields: (fieldIds: string[]) =>
      fieldIds.length
        ? db
            .select()
            .from(inventoryFieldOptions)
            .where(
              and(
                inArray(inventoryFieldOptions.fieldId, fieldIds),
                isNull(inventoryFieldOptions.deletedAt),
              ),
            )
            .orderBy(asc(inventoryFieldOptions.position))
            .all()
        : [],
    find: (fieldId: string, optionId: string) =>
      db
        .select()
        .from(inventoryFieldOptions)
        .where(activeOption(fieldId, optionId))
        .get(),
    count: (fieldId: string) =>
      db
        .select({ count: count() })
        .from(inventoryFieldOptions)
        .where(activeField(fieldId))
        .get()?.count ?? 0,
    create: (data: typeof inventoryFieldOptions.$inferInsert) =>
      db.insert(inventoryFieldOptions).values(data).returning().get(),
    createInitial(fieldId: string, options: { name: string }[]) {
      if (options.length)
        db.insert(inventoryFieldOptions)
          .values(
            options.map((option, position) => ({
              fieldId,
              name: option.name,
              position,
            })),
          )
          .run();
    },
    rename: (fieldId: string, optionId: string, name: string) =>
      db
        .update(inventoryFieldOptions)
        .set({ name })
        .where(activeOption(fieldId, optionId))
        .returning()
        .get(),
    tombstone: (fieldId: string, optionId: string) =>
      db
        .update(inventoryFieldOptions)
        .set({ name: "", deletedAt: new Date().toISOString() })
        .where(activeOption(fieldId, optionId))
        .run(),
  };
}
