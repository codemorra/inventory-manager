import { and, asc, eq, isNull } from "drizzle-orm";
import { inventories } from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";

/**
 * Creates a repository for managing inventories.
 * @param db - The application's database connection.
 * @returns An object with methods to list, find, create, update, and tombstone inventories.
 */
export function createInventoryRepository(db: AppDatabase) {
  const active = (id: string) =>
    and(eq(inventories.id, id), isNull(inventories.deletedAt));
  return {
    list: () =>
      db
        .select()
        .from(inventories)
        .where(isNull(inventories.deletedAt))
        .orderBy(asc(inventories.name))
        .all(),
    find: (id: string) => db.select().from(inventories).where(active(id)).get(),
    create: (data: {
      name: string;
      description: string | null;
      groupId: string | null;
    }) => db.insert(inventories).values(data).returning().get(),
    update: (
      id: string,
      changes: {
        name?: string;
        description?: string | null;
        groupId?: string | null;
      },
    ) =>
      db.update(inventories).set(changes).where(active(id)).returning().get(),
    tombstone: (id: string, deletedAt = new Date().toISOString()) =>
      db
        .update(inventories)
        .set({
          name: "",
          description: null,
          groupId: null,
          deletedAt,
          updatedAt: deletedAt,
        })
        .where(active(id))
        .run(),
  };
}
