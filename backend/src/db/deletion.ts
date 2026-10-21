import { and, eq, inArray, isNull, type SQLWrapper } from "drizzle-orm";
import {
  inventoryFieldOptions,
  inventoryFields,
  inventoryItems,
  inventoryItemValues,
} from "./schema.js";
import type { AppDatabase } from "./types.js";

/**
 * Clear values and option names while retaining identities and existing deletion history.
 * @param db The transaction shared with the parent deletion.
 * @param fieldIds The subquery selecting the affected field identifiers.
 * @param deletedAt The deletion timestamp shared by all newly deleted records.
 */
function tombstoneFieldDependents(
  db: AppDatabase,
  fieldIds: SQLWrapper,
  deletedAt: string,
) {
  db.update(inventoryItemValues)
    .set({ value: null, deletedAt, updatedAt: deletedAt })
    .where(
      and(
        inArray(inventoryItemValues.fieldId, fieldIds),
        isNull(inventoryItemValues.deletedAt),
      ),
    )
    .run();
  db.update(inventoryFieldOptions)
    .set({ name: "", deletedAt, updatedAt: deletedAt })
    .where(
      and(
        inArray(inventoryFieldOptions.fieldId, fieldIds),
        isNull(inventoryFieldOptions.deletedAt),
      ),
    )
    .run();
}

/**
 * Tombstone a field's active values and options inside the caller's transaction.
 * @param db The transaction used to delete the field definition.
 * @param fieldId The validated field whose dependent content is being removed.
 * @param deletedAt The timestamp used for this complete deletion.
 */
export function tombstoneFieldContents(
  db: AppDatabase,
  fieldId: string,
  deletedAt: string,
) {
  const fieldIds = db
    .select({ id: inventoryFields.id })
    .from(inventoryFields)
    .where(eq(inventoryFields.id, fieldId));
  tombstoneFieldDependents(db, fieldIds, deletedAt);
}

/**
 * Clear an inventory's dependent content without physically removing synchronization identities.
 * @param db The transaction used to delete the inventory itself.
 * @param inventoryId The validated inventory whose descendants are being removed.
 * @param deletedAt The timestamp shared by the parent and newly deleted descendants.
 */
export function tombstoneInventoryContents(
  db: AppDatabase,
  inventoryId: string,
  deletedAt: string,
) {
  // Include previously deleted parents so their still-active descendants cannot become orphaned content.
  const fieldIds = db
    .select({ id: inventoryFields.id })
    .from(inventoryFields)
    .where(eq(inventoryFields.inventoryId, inventoryId));
  const itemIds = db
    .select({ id: inventoryItems.id })
    .from(inventoryItems)
    .where(eq(inventoryItems.inventoryId, inventoryId));
  tombstoneFieldDependents(db, fieldIds, deletedAt);
  db.update(inventoryItemValues)
    .set({ value: null, deletedAt, updatedAt: deletedAt })
    .where(
      and(
        inArray(inventoryItemValues.itemId, itemIds),
        isNull(inventoryItemValues.deletedAt),
      ),
    )
    .run();
  db.update(inventoryItems)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(
      and(
        eq(inventoryItems.inventoryId, inventoryId),
        isNull(inventoryItems.deletedAt),
      ),
    )
    .run();
  db.update(inventoryFields)
    .set({ name: "", deletedAt, updatedAt: deletedAt })
    .where(
      and(
        eq(inventoryFields.inventoryId, inventoryId),
        isNull(inventoryFields.deletedAt),
      ),
    )
    .run();
}
