import type { AppDatabase } from "../db/types.js";
import { ZodError } from "zod";
import { DomainError } from "../errors.js";
import { createFieldRepository } from "../fields/repository.js";
import { createInventoryEditorService } from "../inventories/editor-service.js";
import { createInventoryService } from "../inventories/service.js";
import { createOptionRepository } from "../options/repository.js";
import { createTemplateRepository } from "./repository.js";
import {
  templateCreateSchema,
  templateFieldSchema,
  templateInstantiateSchema,
  templateRevisionSchema,
  templateUpdateSchema,
} from "./validation.js";

/**
 * Persist structure-only templates and atomically materialize independent inventories.
 * @param db The application database; nested operations always use the current transaction.
 * @returns Blueprint CRUD and inventory creation operations.
 */
export function createTemplateService(db: AppDatabase) {
  const repository = createTemplateRepository(db);

  /**
   * Resolve an active template, excluding deletion tombstones.
   * @param id The template identifier.
   * @returns The complete saved blueprint.
   */
  function get(id: string) {
    const template = repository.find(id);
    if (!template)
      throw new DomainError(
        "inventory_template_not_found",
        "Inventory template not found.",
      );
    return template;
  }

  /**
   * Reject stale or exhausted revisions before any content is replaced.
   * @param transaction The enclosing write transaction.
   * @param id The active template being changed.
   * @param expectedRevision The revision captured by the caller.
   */
  function claim(
    transaction: AppDatabase,
    id: string,
    expectedRevision: number,
  ) {
    createTemplateService(transaction).get(id);
    if (!createTemplateRepository(transaction).claim(id, expectedRevision))
      throw new DomainError(
        "inventory_template_conflict",
        "The template has changed. Reload it before continuing.",
      );
  }

  return {
    get,
    list: repository.list,

    /**
     * Save an explicit structure or capture the requested inventory revision without its data.
     * @param input Template metadata and either fields or a source inventory and revision.
     * @returns The independent saved blueprint, without source IDs or counters.
     */
    create(input: unknown) {
      const data = templateCreateSchema.parse(input);
      return db.transaction((transaction) => {
        let fields;
        if ("fields" in data) fields = data.fields;
        else {
          const source = createInventoryEditorService(transaction).read(
            data.source_inventory_id,
          );
          if (
            source.inventory.configurationRevision !==
            data.expected_configuration_revision
          )
            throw new DomainError(
              "inventory_configuration_conflict",
              "The inventory configuration has changed. Reload it before saving a template.",
            );
          fields = source.fields.map((field) =>
            templateFieldSchema.parse({
              name: field.name,
              field_type: field.fieldType,
              max_length: field.maxLength,
              is_required: field.isRequired,
              is_sortable: field.isSortable,
              reuse_deleted_ids: field.reuseDeletedIds,
              options: field.options.map((option) => ({ name: option.name })),
            }),
          );
        }
        return createTemplateRepository(transaction).create({
          name: data.name,
          description: data.description,
          fields,
        });
      });
    },

    /**
     * Replace template metadata and optionally its entire ordered structure atomically.
     * @param id The template being edited.
     * @param input The expected revision and replacement properties.
     * @returns The updated blueprint with its new revision.
     */
    update(id: string, input: unknown) {
      const data = templateUpdateSchema.parse(input);
      const changes = {
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.description === undefined
          ? {}
          : { description: data.description }),
        ...(data.fields === undefined ? {} : { fields: data.fields }),
      };
      return db.transaction((transaction) => {
        claim(transaction, id, data.expected_revision);
        const templates = createTemplateRepository(transaction);
        // Accepted no-op saves still consume a revision, as in the inventory editor.
        return Object.keys(changes).length
          ? templates.update(id, changes)!
          : templates.find(id)!;
      });
    },

    /**
     * Clear all blueprint content while retaining its identifier and deletion history.
     * @param id The template being deleted.
     * @param input The revision confirmed for deletion.
     */
    delete(id: string, input: unknown) {
      const data = templateRevisionSchema.parse(input);
      db.transaction((transaction) => {
        claim(transaction, id, data.expected_revision);
        createTemplateRepository(transaction).update(id, {
          name: "",
          description: null,
          fields: [],
          deletedAt: new Date().toISOString(),
        });
      });
    },

    /**
     * Create an empty inventory with new field and option IDs and fresh automatic counters.
     * @param id The template selected by the user.
     * @param input New inventory metadata, destination group, and the selected template revision.
     * @returns The new inventory and its ordered field configuration.
     */
    instantiate(id: string, input: unknown) {
      const data = templateInstantiateSchema.parse(input);
      return db.transaction((transaction) => {
        const template = createTemplateService(transaction).get(id);
        if (template.revision !== data.expected_revision)
          throw new DomainError(
            "inventory_template_conflict",
            "The template has changed. Reload it before creating an inventory.",
          );
        if (
          data.field_indexes?.some((index) => index >= template.fields.length)
        )
          throw new ZodError([
            {
              code: "custom",
              path: ["field_indexes"],
              message:
                "Selected fields must belong to the requested template revision.",
            },
          ]);
        const selected =
          data.field_indexes === undefined ? null : new Set(data.field_indexes);
        // Keep the template's field order and normalize positions after omitted fields.
        const definitions = template.fields.filter(
          (_, index) => selected === null || selected.has(index),
        );
        const inventory = createInventoryService(transaction).create(data);
        const fields = createFieldRepository(transaction);
        const options = createOptionRepository(transaction);
        for (const [position, definition] of definitions.entries()) {
          const field = templateFieldSchema.parse(definition);
          // The destination is empty: preserve even empty option lists, with no ID backfill.
          const created = fields.create({
            inventoryId: inventory.id,
            name: field.name,
            fieldType: field.field_type,
            maxLength: field.max_length,
            isRequired: field.is_required,
            isSortable: field.is_sortable,
            reuseDeletedIds: field.reuse_deleted_ids,
            position,
          });
          options.createInitial(created.id, field.options);
        }
        return createInventoryEditorService(transaction).read(inventory.id);
      });
    },
  };
}
