import { and, asc, eq, isNull } from "drizzle-orm";
import {
  inventoryFields,
  inventoryItems,
  inventoryItemValues,
} from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";
import { DomainError } from "../errors.js";

/**
 * Allocate and store a number inside the caller's item or editor transaction.
 * @param db The transaction shared with the surrounding write operation.
 * @param fieldId The ID field owning an independent sequence.
 * @param itemId The active item receiving its immutable number.
 * @throws DomainError when no safe integer number remains available.
 */
export function assignAutomaticId(
  db: AppDatabase,
  fieldId: string,
  itemId: string,
) {
  const field = db
    .select()
    .from(inventoryFields)
    .where(eq(inventoryFields.id, fieldId))
    .get()!;
  let next = field.lastAssignedId + 1;
  if (field.reuseDeletedIds) {
    // Deleted values contain no content; only active assignments reserve reusable numbers.
    const occupied = db
      .select({ value: inventoryItemValues.value })
      .from(inventoryItemValues)
      .innerJoin(
        inventoryItems,
        eq(inventoryItems.id, inventoryItemValues.itemId),
      )
      .where(
        and(
          eq(inventoryItemValues.fieldId, fieldId),
          isNull(inventoryItemValues.deletedAt),
          isNull(inventoryItems.deletedAt),
        ),
      )
      .all()
      .map(({ value }) => value)
      .filter((value): value is number => typeof value === "number")
      .sort((a, b) => a - b);
    next = 1;
    for (const value of occupied) {
      if (value === next) next += 1;
      else if (value > next) break;
    }
  }
  if (!Number.isSafeInteger(next) || next < 1) {
    throw new DomainError(
      "automatic_id_exhausted",
      "No safe automatic ID number is available.",
    );
  }
  db.insert(inventoryItemValues).values({ itemId, fieldId, value: next }).run();
  // Retain the high-water mark even when deleted numbers may temporarily be reused.
  if (next > field.lastAssignedId)
    db.update(inventoryFields)
      .set({ lastAssignedId: next, updatedAt: field.updatedAt })
      .where(eq(inventoryFields.id, fieldId))
      .run();
}

/**
 * Number existing active items deterministically when an ID field is saved.
 * @param db The field creation transaction, rolled back with the editor on failure.
 * @param inventoryId The inventory containing the existing items.
 * @param fieldId The newly created ID field.
 */
export function backfillAutomaticIds(
  db: AppDatabase,
  inventoryId: string,
  fieldId: string,
) {
  const items = db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(
      and(
        eq(inventoryItems.inventoryId, inventoryId),
        isNull(inventoryItems.deletedAt),
      ),
    )
    .orderBy(asc(inventoryItems.createdAt), asc(inventoryItems.id))
    .all();
  // New fields have no assignments; batch the initial sequence without repeated scans.
  for (let start = 0; start < items.length; start += 200) {
    db.insert(inventoryItemValues)
      .values(
        items.slice(start, start + 200).map((item, offset) => ({
          itemId: item.id,
          fieldId,
          value: start + offset + 1,
        })),
      )
      .run();
  }
  db.update(inventoryFields)
    .set({ lastAssignedId: items.length })
    .where(eq(inventoryFields.id, fieldId))
    .run();
}
