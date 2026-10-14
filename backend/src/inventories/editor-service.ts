import type { AppDatabase } from "../db/types.js";
import { eq } from "drizzle-orm";
import { inventoryFieldOptions } from "../db/schema.js";
import { createFieldService } from "../fields/service.js";
import { createOptionService } from "../options/service.js";
import { createInventoryService } from "./service.js";
import { inventoryEditorSchema } from "./editor-validation.js";

/**
 * Compose atomic persistence for inventory editor drafts.
 * @param db The database connection used to save the complete draft.
 * @returns The operation for saving metadata, fields, and options together.
 */
export function createInventoryEditorService(db: AppDatabase) {
  return {
    /**
     * Commit all draft changes or leave every affected record unchanged.
     * @param inventoryId The inventory being edited.
     * @param input The untrusted metadata and field or option operations.
     * @returns The updated inventory and its active fields with options.
     */
    save(inventoryId: string, input: unknown) {
      const draft = inventoryEditorSchema.parse(input);
      return db.transaction((transaction) => {
        // Every nested service must use this transaction, including its validation reads.
        const inventories = createInventoryService(transaction);
        const fields = createFieldService(transaction, inventories);
        const options = createOptionService(transaction, fields);
        const inventory = inventories.update(inventoryId, draft.inventory);
        for (const change of draft.fields) {
          if (change.action === "create") {
            // Active counts can reuse an occupied position after earlier deletions.
            const position =
              Math.max(
                -1,
                ...fields.list(inventoryId).map((field) => field.position),
              ) + 1;
            const created = fields.create(inventoryId, change.data);
            fields.update(inventoryId, created.id, { position });
          } else if (change.action === "update")
            fields.update(inventoryId, change.field_id, change.data);
          else fields.delete(inventoryId, change.field_id);
        }
        for (const change of draft.options) {
          if (change.action === "create") {
            const position =
              Math.max(
                -1,
                ...options
                  .list(inventoryId, change.field_id)
                  .map((option) => option.position),
              ) + 1;
            const created = options.create(
              inventoryId,
              change.field_id,
              change.data,
            );
            if (created.position !== position) {
              transaction
                .update(inventoryFieldOptions)
                .set({ position })
                .where(eq(inventoryFieldOptions.id, created.id))
                .run();
            }
          } else if (change.action === "update")
            options.update(
              inventoryId,
              change.field_id,
              change.option_id,
              change.data,
            );
          else options.delete(inventoryId, change.field_id, change.option_id);
        }
        // Existing item values and deletion tombstones retain their established semantics.
        return { inventory, fields: fields.list(inventoryId) };
      });
    },
  };
}
