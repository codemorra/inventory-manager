import type { InventoryField } from "../types/inventoryField";
import type { InventoryItemValueInput } from "../types/inventoryItem";

/** Define values held by inventory item form controls. */
export type InventoryItemFormValue = string | boolean | string[];

/** Return the initial form value for an inventory field. */
export function getInitialValue(field: InventoryField): InventoryItemFormValue {
  if (field.field_type === "boolean") {
    return false;
  }

  if (field.field_type === "multiselect") {
    return [];
  }

  return "";
}

/** Convert a non-empty form value into its API representation. */
export function createValueInput(
  field: InventoryField,
  value: InventoryItemFormValue,
): InventoryItemValueInput | null {
  if (field.field_type === "boolean") {
    return { field_id: field.id, value };
  }

  if (Array.isArray(value)) {
    return value.length ? { field_id: field.id, value } : null;
  }

  if (!value) {
    return null;
  }

  if (field.field_type === "number" || field.field_type === "duration") {
    return { field_id: field.id, value: Number(value) };
  }

  return { field_id: field.id, value };
}
