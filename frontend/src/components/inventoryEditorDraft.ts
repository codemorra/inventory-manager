import type {
  CreateInventoryFieldInput,
  InventoryField,
  UpdateInventoryFieldInput,
} from "../types/inventoryField";
import type { InventoryEditorInput } from "../types/inventoryEditor";

/**
 * Create a locally identified field without writing to the server or query cache.
 * @param inventoryId The inventory owning the draft.
 * @param data The new field definition.
 * @returns A field with temporary identifiers, including its initial options.
 */
export function createDraftField(
  inventoryId: string,
  data: CreateInventoryFieldInput,
): InventoryField {
  const id = crypto.randomUUID();
  return {
    id,
    inventory_id: inventoryId,
    name: data.name,
    field_type: data.field_type ?? "text",
    max_length:
      (data.field_type ?? "text") === "text" ? (data.max_length ?? 255) : null,
    is_required: data.is_required ?? false,
    is_sortable: data.is_sortable ?? true,
    options: (data.options ?? []).map((option, position) => ({
      id: crypto.randomUUID(),
      field_id: id,
      name: option.name,
      position,
      created_at: "",
      updated_at: "",
    })),
    position: 0,
    created_at: "",
    updated_at: "",
  };
}

/**
 * Translate a session snapshot and its edited copy into atomic API operations.
 * @param original The saved field snapshot captured when the editor opened.
 * @param current The locally edited fields and options.
 * @param inventory The edited inventory metadata.
 * @returns Operations that preserve saved identifiers and omit discarded draft objects.
 */
export function buildInventoryEditorInput(
  original: InventoryField[],
  current: InventoryField[],
  inventory: InventoryEditorInput["inventory"],
): InventoryEditorInput {
  const result: InventoryEditorInput = { inventory, fields: [], options: [] };
  for (const saved of original) {
    if (!current.some((field) => field.id === saved.id))
      result.fields.push({ action: "delete", field_id: saved.id });
  }
  for (const field of current) {
    const saved = original.find((entry) => entry.id === field.id);
    if (!saved) {
      result.fields.push({
        action: "create",
        data: {
          name: field.name,
          field_type: field.field_type,
          is_required: field.is_required,
          is_sortable: field.is_sortable,
          ...(field.field_type === "text"
            ? { max_length: field.max_length ?? 255 }
            : {}),
          ...(["select", "multiselect"].includes(field.field_type)
            ? {
                options: field.options.map((option) => ({ name: option.name })),
              }
            : {}),
        },
      });
      continue;
    }
    const changes: UpdateInventoryFieldInput = {};
    if (saved.name !== field.name) changes.name = field.name;
    if (saved.is_required !== field.is_required)
      changes.is_required = field.is_required;
    if (saved.is_sortable !== field.is_sortable)
      changes.is_sortable = field.is_sortable;
    if (Object.keys(changes).length)
      result.fields.push({
        action: "update",
        field_id: field.id,
        data: changes,
      });
    for (const option of saved.options) {
      if (!field.options.some((entry) => entry.id === option.id))
        result.options.push({
          action: "delete",
          field_id: field.id,
          option_id: option.id,
        });
    }
    for (const option of field.options) {
      const previous = saved.options.find((entry) => entry.id === option.id);
      if (!previous)
        result.options.push({
          action: "create",
          field_id: field.id,
          data: { name: option.name },
        });
      else if (previous.name !== option.name)
        result.options.push({
          action: "update",
          field_id: field.id,
          option_id: option.id,
          data: { name: option.name },
        });
    }
  }
  return result;
}

/**
 * Check draft constraints that can change after a field's initial creation.
 * @param original The saved fields whose immutable configuration is retained.
 * @param fields The draft fields to validate before saving.
 * @returns Whether field and option names and new selection definitions are valid.
 */
export function isValidFieldDraft(
  original: InventoryField[],
  fields: InventoryField[],
): boolean {
  return fields.every((field) => {
    if (
      !field.name.trim() ||
      field.options.some((option) => !option.name.trim())
    )
      return false;
    if (
      !original.some((saved) => saved.id === field.id) &&
      ["select", "multiselect"].includes(field.field_type)
    ) {
      const names = field.options.map((option) =>
        option.name.trim().toLowerCase(),
      );
      return names.length > 0 && new Set(names).size === names.length;
    }
    return true;
  });
}
