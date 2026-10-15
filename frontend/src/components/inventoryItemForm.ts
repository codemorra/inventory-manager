import type { InventoryField } from "../types/inventoryField";
import type { InventoryItemValueInput } from "../types/inventoryItem";

/** Define values held by inventory item form controls. */
export type InventoryItemFormValue = string | boolean | string[];

/**
 * Initialize controls without implicitly answering required yes/no fields.
 * @param field The field whose input is being initialized.
 * @returns An empty value, or false for an optional checkbox.
 */
export function getInitialValue(field: InventoryField): InventoryItemFormValue {
  if (field.field_type === "boolean") {
    return field.is_required ? "" : false;
  }

  if (field.field_type === "multiselect") {
    return [];
  }

  return "";
}

/**
 * Check that all required controls contain an explicit, non-empty value.
 * @param fields The active field definitions.
 * @param values The current form values, including omitted untouched controls.
 * @returns Whether every required field is filled; false and zero remain valid.
 */
export function hasRequiredItemValues(
  fields: InventoryField[],
  values: Record<string, InventoryItemFormValue>,
): boolean {
  return fields.every((field) => {
    if (!field.is_required) return true;
    const value = values[field.id] ?? getInitialValue(field);
    if (field.field_type === "boolean") return typeof value === "boolean";
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === "string" && value.trim().length > 0;
  });
}

/**
 * Convert a non-empty form value into its API representation.
 * @param field The field defining the value's type.
 * @param value The current control value.
 * @returns A typed API value, or null for an unfilled optional control.
 */
export function createValueInput(
  field: InventoryField,
  value: InventoryItemFormValue,
): InventoryItemValueInput | null {
  if (field.field_type === "boolean") {
    return typeof value === "boolean" ? { field_id: field.id, value } : null;
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
