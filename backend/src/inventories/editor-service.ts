import type { AppDatabase } from "../db/types.js";
import { eq } from "drizzle-orm";
import { ZodError } from "zod";
import { inventoryFieldOptions } from "../db/schema.js";
import { createFieldService } from "../fields/service.js";
import { createOptionService } from "../options/service.js";
import { createInventoryService } from "./service.js";
import { inventoryEditorSchema } from "./editor-validation.js";
import { createInventoryRepository } from "./repository.js";
import { DomainError } from "../errors.js";

/**
 * Compose atomic persistence for inventory editor drafts.
 * @param db The database connection used to save the complete draft.
 * @returns Operations to read consistent snapshots and save complete configuration drafts.
 */
export function createInventoryEditorService(db: AppDatabase) {
  return {
    /**
     * Read metadata, revision, fields, and options as one consistent database snapshot.
     * @param inventoryId The inventory whose configuration is requested.
     * @returns The active inventory and its ordered field definitions with options.
     */
    read(inventoryId: string) {
      return db.transaction((transaction) => {
        const inventories = createInventoryService(transaction);
        return {
          inventory: inventories.get(inventoryId),
          fields: createFieldService(transaction, inventories).list(
            inventoryId,
          ),
        };
      });
    },
    /**
     * Commit all draft changes or leave every affected record unchanged.
     * @param inventoryId The inventory being edited.
     * @param input The expected revision, metadata, and field or option operations.
     * @returns The updated inventory and its active fields with options.
     * @throws DomainError if the inventory is missing or its configuration revision is stale.
     */
    save(inventoryId: string, input: unknown) {
      const draft = inventoryEditorSchema.parse(input);
      return db.transaction((transaction) => {
        // Every nested service must use this transaction, including its validation reads.
        const inventories = createInventoryService(transaction);
        inventories.get(inventoryId);
        if (
          !createInventoryRepository(transaction).claimConfiguration(
            inventoryId,
            draft.expected_revision,
          )
        )
          throw new DomainError(
            "inventory_configuration_conflict",
            "The inventory configuration has changed. Reload it before saving.",
          );
        const fields = createFieldService(transaction, inventories);
        const options = createOptionService(transaction, fields);
        inventories.update(inventoryId, draft.inventory);
        const createdFieldIds = new Map<string, string>();
        for (const change of draft.fields) {
          if (change.action === "create") {
            // Active counts can reuse an occupied position after earlier deletions.
            const position =
              Math.max(
                -1,
                ...fields.list(inventoryId).map((field) => field.position),
              ) + 1;
            const created = fields.create(inventoryId, change.data);
            if (change.client_id !== undefined)
              createdFieldIds.set(change.client_id, created.id);
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
        if (draft.field_order !== undefined) {
          const activeFields = fields.list(inventoryId);
          const activeIds = new Set(activeFields.map((field) => field.id));
          const orderedIds = draft.field_order.map((reference) =>
            "field_id" in reference
              ? reference.field_id
              : createdFieldIds.get(reference.client_id),
          );
          // Validate the entire final set before writing positions; any failure rolls back the draft.
          if (
            orderedIds.length !== activeIds.size ||
            new Set(orderedIds).size !== activeIds.size ||
            orderedIds.some((id) => id === undefined || !activeIds.has(id))
          ) {
            throw new ZodError([
              {
                code: "custom",
                path: ["field_order"],
                message:
                  "Field order must reference every active field exactly once.",
              },
            ]);
          }
          orderedIds.forEach((id, position) => {
            fields.update(inventoryId, id!, { position });
          });
        }
        // Newly created ID fields have backfilled assignments; other values retain their established semantics.
        return {
          inventory: inventories.get(inventoryId),
          fields: fields.list(inventoryId),
        };
      });
    },
  };
}
