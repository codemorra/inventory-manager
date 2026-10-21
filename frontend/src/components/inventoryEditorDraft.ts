import type {
  CreateInventoryFieldInput,
  InventoryField,
  UpdateInventoryFieldInput,
} from "../types/inventoryField";
import type { InventoryEditorInput } from "../types/inventoryEditor";

// Locate a dragged field relative to its drop target without adding persistent metadata.
export type FieldDropSide = "before" | "after";

/**
 * Move a field within a local draft while retaining its definition and option identifiers.
 * @param fields The current ordered draft fields.
 * @param sourceId The saved or temporary identifier being moved.
 * @param targetId The field serving as the insertion target.
 * @param side Whether to insert before or after the target.
 * @returns Reordered fields with consecutive local positions, or the original array for a no-op.
 */
export function moveDraftField(
  fields: InventoryField[],
  sourceId: string,
  targetId: string,
  side: FieldDropSide,
): InventoryField[] {
  const source = fields.find((field) => field.id === sourceId);
  if (
    !source ||
    sourceId === targetId ||
    !fields.some((field) => field.id === targetId)
  )
    return fields;
  const ordered = fields.filter((field) => field.id !== sourceId);
  const targetIndex = ordered.findIndex((field) => field.id === targetId);
  ordered.splice(targetIndex + (side === "after" ? 1 : 0), 0, source);
  if (ordered.every((field, index) => field.id === fields[index]?.id))
    return fields;
  return ordered.map((field, position) => ({ ...field, position }));
}

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
    ...(data.field_type === "id" && {
      reuse_deleted_ids: data.reuse_deleted_ids ?? false,
    }),
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
 * @param expectedRevision The configuration revision captured with the original field snapshot.
 * @returns Operations that preserve saved identifiers and omit discarded draft objects.
 */
export function buildInventoryEditorInput(
  original: InventoryField[],
  current: InventoryField[],
  inventory: InventoryEditorInput["inventory"],
  expectedRevision: number,
): InventoryEditorInput {
  const result: InventoryEditorInput = {
    inventory,
    expected_revision: expectedRevision,
    fields: [],
    options: [],
  };
  const savedIds = new Set(original.map((field) => field.id));
  const currentIds = new Set(current.map((field) => field.id));
  // Without explicit order, the server retains surviving fields and appends newly created ones.
  const appendOrder = [
    ...original.filter((field) => currentIds.has(field.id)),
    ...current.filter((field) => !savedIds.has(field.id)),
  ];
  const reordered = current.some(
    (field, index) => field.id !== appendOrder[index]?.id,
  );
  if (reordered)
    result.field_order = current.map((field) =>
      savedIds.has(field.id) ? { field_id: field.id } : { client_id: field.id },
    );
  for (const saved of original) {
    if (!current.some((field) => field.id === saved.id))
      result.fields.push({ action: "delete", field_id: saved.id });
  }
  for (const field of current) {
    const saved = original.find((entry) => entry.id === field.id);
    if (!saved) {
      result.fields.push({
        action: "create",
        ...(reordered && { client_id: field.id }),
        data: {
          name: field.name,
          field_type: field.field_type,
          is_required: field.is_required,
          is_sortable: field.is_sortable,
          ...(field.field_type === "id" && {
            reuse_deleted_ids: field.reuse_deleted_ids ?? false,
          }),
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
    if (
      field.field_type === "id" &&
      Boolean(saved.reuse_deleted_ids) !== Boolean(field.reuse_deleted_ids)
    )
      changes.reuse_deleted_ids = Boolean(field.reuse_deleted_ids);
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
