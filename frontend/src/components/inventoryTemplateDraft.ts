import type { InventoryField } from "../types/inventoryField";
import type {
  InventoryTemplate,
  InventoryTemplateField,
} from "../types/inventoryTemplate";
import { createDraftField } from "./inventoryEditorDraft";

/**
 * Adapt an ordered blueprint to the shared local field editor without persisted identities.
 * @param template The immutable saved template snapshot.
 * @returns Independent fields/options with temporary IDs used only by the editor.
 */
export function createTemplateDraft(
  template: InventoryTemplate,
): InventoryField[] {
  return template.fields.map((field, position) => ({
    ...createDraftField(template.id, {
      name: field.name,
      field_type: field.field_type,
      is_required: field.is_required,
      is_sortable: field.is_sortable,
      reuse_deleted_ids: field.reuse_deleted_ids,
      ...(field.max_length === null ? {} : { max_length: field.max_length }),
      options: field.options,
    }),
    position,
  }));
}

/**
 * Serialize the ordered draft with no technical IDs, lifecycle metadata, or counters.
 * @param fields The template's local field definitions and options.
 * @returns The structure-only replacement accepted by the template API.
 */
export function serializeTemplateDraft(
  fields: InventoryField[],
): InventoryTemplateField[] {
  return fields.map((field) => ({
    name: field.name,
    field_type: field.field_type,
    max_length: field.max_length,
    is_required: field.is_required,
    is_sortable: field.is_sortable,
    reuse_deleted_ids: field.reuse_deleted_ids ?? false,
    options: field.options.map((option) => ({ name: option.name })),
  }));
}
