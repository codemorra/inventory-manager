import { and, asc, eq, isNull, sql } from "drizzle-orm";
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
    /**
     * Lists all active inventories.
     * @returns An array of active inventories.
     */
    list: () =>
      db
        .select()
        .from(inventories)
        .where(isNull(inventories.deletedAt))
        .orderBy(asc(inventories.name))
        .all(),

    /**
     * Finds an active inventory by its ID.
     * @param id The ID of the inventory.
     * @returns The inventory if found, otherwise undefined.
     */
    find: (id: string) => db.select().from(inventories).where(active(id)).get(),

    /**
     * Claim an editor revision before applying its complete configuration draft.
     * @param id The active inventory being edited.
     * @param expectedRevision The revision captured with the editor's coherent snapshot.
     * @returns The claimed inventory, or undefined when the snapshot is stale.
     */
    claimConfiguration: (id: string, expectedRevision: number) =>
      db
        .update(inventories)
        .set({
          configurationRevision: sql`${inventories.configurationRevision} + 1`,
        })
        .where(
          and(
            active(id),
            eq(inventories.configurationRevision, expectedRevision),
            sql`${inventories.configurationRevision} < ${Number.MAX_SAFE_INTEGER}`,
          ),
        )
        .returning()
        .get(),

    /**
     * Creates a new inventory.
     * @param data The inventory data.
     * @returns The created inventory.
     */
    create: (data: {
      name: string;
      description: string | null;
      groupId: string | null;
    }) => db.insert(inventories).values(data).returning().get(),

    /**
     * Updates an active inventory.
     * @param id The ID of the inventory to update.
     * @param changes The changes to apply.
     * @returns The updated inventory if successful, otherwise undefined.
     */
    update: (
      id: string,
      changes: {
        name?: string;
        description?: string | null;
        groupId?: string | null;
      },
    ) =>
      db.update(inventories).set(changes).where(active(id)).returning().get(),

    /**
     * Tombstones (soft-deletes) an active inventory.
     * @param id The ID of the inventory to tombstone.
     * @param deletedAt The timestamp of deletion.
     * @returns The result of the tombstone operation.
     */
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
