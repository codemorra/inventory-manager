import { and, inArray, isNull, sql, type SQLWrapper } from "drizzle-orm";
import { inventoryItems } from "./schema.js";
import type { AppDatabase } from "./types.js";

/**
 * Invalidate item snapshots when configuration operations change their stored values.
 * @param db The transaction shared with the field change or ID backfill.
 * @param itemIds The subquery identifying affected items.
 * @param updatedAt The timestamp of the server-side change.
 */
export function advanceItemRevisions(
  db: AppDatabase,
  itemIds: SQLWrapper,
  updatedAt: string,
) {
  db.update(inventoryItems)
    .set({ revision: sql`${inventoryItems.revision} + 1`, updatedAt })
    .where(
      and(
        inArray(inventoryItems.id, itemIds),
        isNull(inventoryItems.deletedAt),
      ),
    )
    .run();
}
