import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../db/types.js";
import { inventories, inventoryGroups } from "../db/schema.js";
import { DomainError } from "../errors.js";
import { nameSchema } from "../validation/common.js";

// Validate group names using the same constraints as inventory names.
const groupSchema = z.object({ name: nameSchema });

/**
 * Create persistent single-level group operations.
 * @param db The active database connection.
 * @returns Operations to list, retrieve, create, rename, and delete groups.
 */
export function createGroupService(db: AppDatabase) {
  /**
   * Retrieve an active group or report a stable not-found error.
   * @param id The group identifier.
   * @returns The stored group.
   */
  function get(id: string) {
    const group = db
      .select()
      .from(inventoryGroups)
      .where(and(eq(inventoryGroups.id, id), isNull(inventoryGroups.deletedAt)))
      .get();
    if (!group)
      throw new DomainError(
        "inventory_group_not_found",
        "Inventory group not found.",
      );
    return group;
  }

  return {
    get,
    // Return active groups in a predictable alphabetical order.
    list() {
      return db
        .select()
        .from(inventoryGroups)
        .where(isNull(inventoryGroups.deletedAt))
        .orderBy(asc(inventoryGroups.name))
        .all();
    },
    /**
     * Create a group with a validated name.
     * @param input The untrusted group creation data.
     * @returns The created group.
     */
    create(input: unknown) {
      return db
        .insert(inventoryGroups)
        .values(groupSchema.parse(input))
        .returning()
        .get();
    },
    /**
     * Rename an existing group.
     * @param id The group identifier.
     * @param input The untrusted group update data.
     * @returns The renamed group.
     */
    update(id: string, input: unknown) {
      const data = groupSchema.parse(input);
      const group = get(id);
      return group.name === data.name
        ? group
        : db
            .update(inventoryGroups)
            .set(data)
            .where(eq(inventoryGroups.id, id))
            .returning()
            .get();
    },
    /**
     * Remove a group while preserving and unassigning its inventories.
     * @param id The group identifier.
     */
    delete(id: string) {
      get(id);
      // Keep membership removal and the deletion tombstone atomic.
      db.transaction((tx) => {
        tx.update(inventories)
          .set({ groupId: null })
          .where(eq(inventories.groupId, id))
          .run();
        tx.update(inventoryGroups)
          .set({ name: "", deletedAt: new Date().toISOString() })
          .where(eq(inventoryGroups.id, id))
          .run();
      });
    },
  };
}

// Define the group service interface for dependent services.
export type GroupService = ReturnType<typeof createGroupService>;
