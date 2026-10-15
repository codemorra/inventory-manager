import type { AppDatabase } from "../db/types.js";
import type { inventoryFieldOptions, inventoryFields } from "../db/schema.js";
import { inventoryItemValues } from "../db/schema.js";
import { and, eq, isNull } from "drizzle-orm";
import { DomainError } from "../errors.js";
import type { InventoryService } from "../inventories/service.js";
import { createOptionRepository } from "../options/repository.js";
import { createFieldRepository } from "./repository.js";
import { fieldCreateSchema, fieldUpdateSchema } from "./validation.js";
import { backfillAutomaticIds } from "../items/automatic-ids.js";

type Field = typeof inventoryFields.$inferSelect;
type Option = typeof inventoryFieldOptions.$inferSelect;

/**
 * Creates a service for managing inventory fields.
 * @param db - The application's database connection.
 * @param inventories - The inventory service.
 * @returns An object with methods to get, read, list, create, update, and delete inventory fields.
 */
export function createFieldService(
  db: AppDatabase,
  inventories: InventoryService,
) {
  const repository = createFieldRepository(db);
  const options = createOptionRepository(db);

  /**
   * Retrieves an inventory field by its ID, ensuring it exists.
   * @param inventoryId - The ID of the inventory.
   * @param fieldId - The ID of the field.
   * @returns The inventory field.
   * @throws DomainError if the field is not found.
   */
  function get(inventoryId: string, fieldId: string) {
    inventories.get(inventoryId);
    const field = repository.find(inventoryId, fieldId);
    if (!field)
      throw new DomainError(
        "inventory_field_not_found",
        "Inventory field not found.",
      );
    return field;
  }

  /**
   * Enhances inventory fields with their associated options.
   * @param fields - The inventory fields to enhance.
   * @returns The inventory fields with their options included.
   */
  function withOptions(fields: Field[]) {
    const grouped = new Map<string, Option[]>();
    for (const option of options.listForFields(
      fields.map((field) => field.id),
    )) {
      const group = grouped.get(option.fieldId) ?? [];
      group.push(option);
      grouped.set(option.fieldId, group);
    }
    return fields.map((field) => ({
      ...field,
      options: grouped.get(field.id) ?? [],
    }));
  }

  return {
    get,
    read(inventoryId: string, fieldId: string) {
      return { ...get(inventoryId, fieldId), options: options.list(fieldId) };
    },
    list(inventoryId: string) {
      inventories.get(inventoryId);
      return withOptions(repository.list(inventoryId));
    },
    create(inventoryId: string, input: unknown) {
      const data = fieldCreateSchema.parse(input);
      inventories.get(inventoryId);
      return db.transaction((transaction) => {
        const fields = createFieldRepository(transaction);
        const field = fields.create({
          inventoryId,
          name: data.name,
          fieldType: data.field_type,
          maxLength: data.max_length,
          isRequired: data.is_required,
          isSortable: data.is_sortable,
          reuseDeletedIds: data.reuse_deleted_ids,
          position: fields.count(inventoryId),
        });
        createOptionRepository(transaction).createInitial(
          field.id,
          data.options,
        );
        if (field.fieldType === "id")
          backfillAutomaticIds(transaction, inventoryId, field.id);
        return {
          ...field,
          options: createOptionRepository(transaction).list(field.id),
        };
      });
    },
    update(inventoryId: string, fieldId: string, input: unknown) {
      const data = fieldUpdateSchema.parse(input);
      const field = get(inventoryId, fieldId);
      if (data.reuse_deleted_ids !== undefined && field.fieldType !== "id")
        throw new DomainError(
          "invalid_inventory_field_configuration",
          "Only ID fields can configure number reuse.",
        );
      const changes: {
        name?: string;
        position?: number;
        isRequired?: boolean;
        isSortable?: boolean;
        reuseDeletedIds?: boolean;
      } = {};
      if (data.name != null && data.name !== field.name)
        changes.name = data.name;
      if (data.position != null && data.position !== field.position)
        changes.position = data.position;
      if (
        data.is_required !== undefined &&
        data.is_required !== field.isRequired
      )
        changes.isRequired = data.is_required;
      if (
        data.is_sortable !== undefined &&
        data.is_sortable !== field.isSortable
      )
        changes.isSortable = data.is_sortable;
      if (
        data.reuse_deleted_ids !== undefined &&
        data.reuse_deleted_ids !== field.reuseDeletedIds
      )
        changes.reuseDeletedIds = data.reuse_deleted_ids;
      const updated = Object.keys(changes).length
        ? repository.update(inventoryId, fieldId, changes)
        : field;
      return { ...updated, options: options.list(fieldId) };
    },
    delete(inventoryId: string, fieldId: string) {
      const field = get(inventoryId, fieldId);
      db.transaction((transaction) => {
        createFieldRepository(transaction).tombstone(inventoryId, fieldId);
        if (field.fieldType === "id") {
          // Remove automatic number content along with the field, retaining deletion indicators.
          transaction
            .update(inventoryItemValues)
            .set({ value: null, deletedAt: new Date().toISOString() })
            .where(
              and(
                eq(inventoryItemValues.fieldId, fieldId),
                isNull(inventoryItemValues.deletedAt),
              ),
            )
            .run();
        }
      });
    },
  };
}

export type FieldService = ReturnType<typeof createFieldService>;
