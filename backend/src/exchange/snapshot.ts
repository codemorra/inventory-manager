import { createHash } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  inventoryAttachments,
  inventoryFieldOptions,
  inventoryFields,
} from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";
import { createInventoryService } from "../inventories/service.js";
import { createFieldRepository } from "../fields/repository.js";
import { createItemRepository } from "../items/repository.js";
import { inventoryManifestSchema, type InventoryManifest } from "./manifest.js";
import { DomainError } from "../errors.js";

/**
 * Read one coherent inventory snapshot and replace source identities with local archive keys.
 * @param db The source connection; every query belongs to a single synchronous read transaction.
 * @param inventoryId The active inventory to export.
 * @returns The portable manifest, private file identities, and a source-change fingerprint.
 */
export function readExportSnapshot(db: AppDatabase, inventoryId: string) {
  return db.transaction((transaction) => {
    const inventory = createInventoryService(transaction).get(inventoryId);
    const fields = createFieldRepository(transaction).list(inventoryId);
    const repository = createItemRepository(transaction);
    const items = repository.list(inventoryId);
    const values = repository.valuesForInventory(inventoryId);
    const options = transaction
      .select({ option: inventoryFieldOptions })
      .from(inventoryFieldOptions)
      .innerJoin(
        inventoryFields,
        eq(inventoryFields.id, inventoryFieldOptions.fieldId),
      )
      .where(
        and(
          eq(inventoryFields.inventoryId, inventoryId),
          isNull(inventoryFields.deletedAt),
        ),
      )
      .orderBy(
        asc(inventoryFieldOptions.position),
        asc(inventoryFieldOptions.id),
      )
      .all()
      .map((row) => row.option);
    const files = transaction
      .select()
      .from(inventoryAttachments)
      .where(
        and(
          eq(inventoryAttachments.inventoryId, inventoryId),
          isNull(inventoryAttachments.deletedAt),
        ),
      )
      .all();
    const fieldKeys = new Map(fields.map((f, i) => [f.id, `f${i + 1}`]));
    const optionKeys = new Map(options.map((o, i) => [o.id, `o${i + 1}`]));
    const selectedOptions = new Set<string>();
    const attachments: InventoryManifest["attachments"] = [];
    const sources: (typeof inventoryAttachments.$inferSelect)[] = [];
    const fileKeys = new Map<string, string>();
    const fileById = new Map(files.map((file) => [file.id, file]));
    const optionById = new Map(options.map((option) => [option.id, option]));
    const fieldById = new Map(fields.map((field) => [field.id, field]));
    const valuesByItem = new Map<string, typeof values>();
    for (const value of values) {
      const row = valuesByItem.get(value.itemId) ?? [];
      row.push(value);
      valuesByItem.set(value.itemId, row);
    }
    const unavailable = () =>
      new DomainError(
        "inventory_export_unavailable",
        "The saved inventory contains unavailable or inconsistent data.",
      );
    const manifest: InventoryManifest = {
      format: "inventory-manager",
      version: 1,
      inventory: { name: inventory.name, description: inventory.description },
      fields: [],
      attachments,
      items: items.map((item, itemIndex) => ({
        key: `i${itemIndex + 1}`,
        values: (valuesByItem.get(item.id) ?? []).map((cell) => {
          const field = fieldById.get(cell.fieldId);
          const fieldKey = fieldKeys.get(cell.fieldId);
          if (!field || !fieldKey) throw unavailable();
          let value = cell.value;
          const optionKey = (id: unknown) => {
            if (
              typeof id !== "string" ||
              optionById.get(id)?.fieldId !== field.id
            )
              throw unavailable();
            selectedOptions.add(id);
            return optionKeys.get(id)!;
          };
          if (field.fieldType === "select") value = optionKey(value);
          if (field.fieldType === "multiselect") {
            if (!Array.isArray(value)) throw unavailable();
            value = value.map(optionKey);
          }
          if (field.fieldType === "attachment") {
            if (!Array.isArray(value)) throw unavailable();
            value = value.map((id: unknown) => {
              if (typeof id !== "string" || fileKeys.has(id))
                throw unavailable();
              const file = fileById.get(id);
              if (
                !file ||
                file.fieldId !== field.id ||
                file.itemId !== item.id ||
                !file.sha256
              )
                throw unavailable();
              const key = `a${attachments.length + 1}`;
              fileKeys.set(id, key);
              sources.push(file);
              attachments.push({
                key,
                field: fieldKey,
                item: `i${itemIndex + 1}`,
                filename: file.filename,
                media_type: file.mediaType,
                byte_size: file.byteSize,
                sha256: file.sha256,
              });
              return key;
            });
          }
          if (value === undefined) throw unavailable();
          return { field: fieldKey, value };
        }),
      })),
    };
    manifest.fields = fields.map((field) => ({
      key: fieldKeys.get(field.id)!,
      name: field.name,
      field_type: field.fieldType,
      max_length: field.maxLength,
      is_required: field.isRequired,
      is_sortable: field.isSortable,
      reuse_deleted_ids: field.reuseDeletedIds,
      last_assigned_id: field.lastAssignedId,
      options: options
        .filter(
          (option) =>
            option.fieldId === field.id &&
            (option.deletedAt === null || selectedOptions.has(option.id)),
        )
        .map((option) =>
          option.deletedAt === null
            ? {
                key: optionKeys.get(option.id)!,
                available: true as const,
                name: option.name,
              }
            : {
                key: optionKeys.get(option.id)!,
                available: false as const,
                name: null,
              },
        ),
    }));
    const validated = inventoryManifestSchema.safeParse(manifest);
    if (!validated.success) throw unavailable();
    return {
      manifest: validated.data,
      sources,
      fingerprint: createHash("sha256")
        .update(
          JSON.stringify({
            inventory,
            fields,
            items,
            values,
            sources,
            options: options.filter(
              (o) => o.deletedAt === null || selectedOptions.has(o.id),
            ),
          }),
        )
        .digest("hex"),
    };
  });
}
