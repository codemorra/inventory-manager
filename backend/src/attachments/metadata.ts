import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import { inventoryAttachments, inventoryFields } from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";
import { DomainError } from "../errors.js";
import type { ValueInput } from "../items/validation.js";

// Cleared tombstones retain only identities, parent links, and lifecycle/cleanup state.
export const clearedAttachment = {
  filename: "",
  mediaType: "",
  byteSize: 0,
  sha256: null,
};

/**
 * Clear attachment metadata within the caller's transaction, leaving physical cleanup until commit.
 * @param db The enclosing item, field, or inventory transaction.
 * @param scope The records whose attachments are being removed.
 * @param deletedAt The shared deletion timestamp.
 */
export function tombstoneAttachments(
  db: AppDatabase,
  scope: SQL | undefined,
  deletedAt = new Date().toISOString(),
) {
  db.update(inventoryAttachments)
    .set({ ...clearedAttachment, deletedAt, updatedAt: deletedAt })
    .where(and(scope, isNull(inventoryAttachments.deletedAt)))
    .run();
}

/**
 * Validate file ownership and apply complete cell replacements without crossing item/field scopes.
 * @param db The item save transaction.
 * @param inventoryId The active inventory being saved.
 * @param itemId The destination item, already created or revision-claimed by the caller.
 * @param values The complete editable item values.
 */
export function replaceItemAttachments(
  db: AppDatabase,
  inventoryId: string,
  itemId: string,
  values: ValueInput[],
) {
  const fileFields = new Set(
    db
      .select({ id: inventoryFields.id })
      .from(inventoryFields)
      .where(
        and(
          eq(inventoryFields.inventoryId, inventoryId),
          eq(inventoryFields.fieldType, "attachment"),
          isNull(inventoryFields.deletedAt),
        ),
      )
      .all()
      .map((field) => field.id),
  );
  const retained = new Set<string>();
  for (const input of values) {
    if (!fileFields.has(input.field_id)) continue;
    for (const id of input.value as string[]) {
      const file = db
        .select()
        .from(inventoryAttachments)
        .where(
          and(
            eq(inventoryAttachments.id, id),
            isNull(inventoryAttachments.deletedAt),
          ),
        )
        .get();
      if (
        !file ||
        file.inventoryId !== inventoryId ||
        file.fieldId !== input.field_id ||
        (file.itemId !== null && file.itemId !== itemId)
      )
        throw new DomainError(
          "invalid_inventory_item_value",
          "Attachment is unavailable or does not belong to this cell.",
        );
      retained.add(id);
      if (file.itemId === null)
        db.update(inventoryAttachments)
          .set({ itemId })
          .where(eq(inventoryAttachments.id, id))
          .run();
    }
  }
  for (const file of db
    .select()
    .from(inventoryAttachments)
    .where(
      and(
        eq(inventoryAttachments.itemId, itemId),
        isNull(inventoryAttachments.deletedAt),
      ),
    )
    .all()) {
    if (!retained.has(file.id))
      tombstoneAttachments(db, eq(inventoryAttachments.id, file.id));
  }
}

/**
 * Read metadata alongside item snapshots, without exposing server storage names or paths.
 * @param db The database used to read item metadata.
 * @param itemIds The returned items whose files are needed.
 * @returns Active metadata grouped by item identifier.
 */
export function attachmentsForItems(db: AppDatabase, itemIds: string[]) {
  const grouped = new Map<
    string,
    (typeof inventoryAttachments.$inferSelect)[]
  >();
  if (!itemIds.length) return grouped;
  // Keep large inventory reads below SQLite's bind-parameter limit.
  for (let start = 0; start < itemIds.length; start += 500) {
    for (const file of db
      .select()
      .from(inventoryAttachments)
      .where(
        and(
          inArray(
            inventoryAttachments.itemId,
            itemIds.slice(start, start + 500),
          ),
          isNull(inventoryAttachments.deletedAt),
        ),
      )
      .all()) {
      const rows = grouped.get(file.itemId!) ?? [];
      rows.push(file);
      grouped.set(file.itemId!, rows);
    }
  }
  return grouped;
}
