import { randomUUID } from "node:crypto";
import {
  inventoryFields,
  inventoryFieldOptions,
  inventoryItems,
  inventoryAttachments,
} from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";
import { createInventoryService } from "../inventories/service.js";
import { createItemRepository } from "../items/repository.js";
import type { inventoryCreateSchema } from "../inventories/validation.js";
import type { InventoryManifest } from "./manifest.js";
import type { z } from "zod";

/**
 * Publish an already validated snapshot and prepared file identities in one SQLite transaction.
 * @param db The destination connection.
 * @param manifest The validated portable inventory snapshot.
 * @param metadata The new inventory metadata and optional local destination group.
 * @param fileIds The generated managed identities whose original bytes are already durable.
 * @returns The new inventory with fresh lifecycle identities and final configuration revision.
 */
export function materializeInventory(
  db: AppDatabase,
  manifest: InventoryManifest,
  metadata: z.output<typeof inventoryCreateSchema>,
  fileIds: Map<string, string>,
) {
  return db.transaction((transaction) => {
    const inventory = createInventoryService(transaction).create(metadata);
    const timestamp = new Date().toISOString();
    const baseTime = Date.now();
    const fields = new Map<string, string>();
    const options = new Map<string, string>();
    const items = new Map<string, string>();
    for (const [position, definition] of manifest.fields.entries()) {
      const id = randomUUID();
      fields.set(definition.key, id);
      transaction
        .insert(inventoryFields)
        .values({
          id,
          inventoryId: inventory.id,
          name: definition.name,
          fieldType: definition.field_type,
          maxLength: definition.max_length,
          isRequired: definition.is_required,
          isSortable: definition.is_sortable,
          reuseDeletedIds: definition.reuse_deleted_ids,
          lastAssignedId: definition.last_assigned_id,
          position,
        })
        .run();
      for (const [optionPosition, option] of definition.options.entries()) {
        const optionId = randomUUID();
        options.set(option.key, optionId);
        transaction
          .insert(inventoryFieldOptions)
          .values({
            id: optionId,
            fieldId: id,
            name: option.available ? option.name : "",
            position: optionPosition,
            deletedAt: option.available ? null : timestamp,
          })
          .run();
      }
    }
    const definitions = new Map(
      manifest.fields.map((field) => [field.key, field]),
    );
    const repository = createItemRepository(transaction);
    for (const [index, item] of manifest.items.entries()) {
      const itemId = randomUUID();
      items.set(item.key, itemId);
      // Reconstruct the archive's explicit newest-first order with fresh distinct timestamps.
      // Ordinary listing sorts by createdAt; regenerated UUIDs must not change that order.
      transaction
        .insert(inventoryItems)
        .values({
          id: itemId,
          inventoryId: inventory.id,
          createdAt: new Date(baseTime - index).toISOString(),
          updatedAt: timestamp,
        })
        .run();
      repository.createValues(
        itemId,
        item.values.map((cell) => {
          const type = definitions.get(cell.field)!.field_type;
          const value =
            type === "select"
              ? options.get(cell.value as string)!
              : type === "multiselect"
                ? (cell.value as string[]).map((key) => options.get(key)!)
                : type === "attachment"
                  ? (cell.value as string[]).map((key) => fileIds.get(key)!)
                  : cell.value;
          return { field_id: fields.get(cell.field)!, value };
        }),
      );
    }
    for (const file of manifest.attachments) {
      transaction
        .insert(inventoryAttachments)
        .values({
          id: fileIds.get(file.key)!,
          inventoryId: inventory.id,
          fieldId: fields.get(file.field)!,
          itemId: items.get(file.item)!,
          filename: file.filename,
          mediaType: file.media_type,
          byteSize: file.byte_size,
          sha256: file.sha256,
        })
        .run();
    }
    return createInventoryService(transaction).get(inventory.id);
  });
}
