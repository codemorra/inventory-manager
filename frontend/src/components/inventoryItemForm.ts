import type { InventoryField } from "../types/inventoryField";
import type { InventoryItemValueInput } from "../types/inventoryItem";
import type { InventoryItem, InventoryItemInput } from "../types/inventoryItem";
import { isUrlInput, isWebAddress, type UrlInput } from "./url";
import {
  durationFromSeconds,
  durationSeconds,
  emptyDuration,
  isDurationInput,
  type DurationInput,
} from "./duration";

// Define values held by inventory item form controls.
export type InventoryItemFormValue =
  string | boolean | string[] | DurationInput | UrlInput;

/**
 * Initialize controls without implicitly answering required yes/no fields.
 * @param field The field whose input is being initialized.
 * @returns An empty value, or false for checkbox fields and optional yes/no fields.
 */
export function getInitialValue(field: InventoryField): InventoryItemFormValue {
  if (field.field_type === "checkbox") return false;
  if (field.field_type === "boolean") {
    return field.is_required ? "" : false;
  }

  if (field.field_type === "multiselect") {
    return [];
  }

  if (field.field_type === "duration") return emptyDuration();
  if (field.field_type === "url") return { url: "", label: "" };

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
    if (field.field_type === "id") return true;
    if (!field.is_required) return true;
    const value = values[field.id] ?? getInitialValue(field);
    if (field.field_type === "url")
      return isUrlInput(value) && isWebAddress(value.url);
    if (field.field_type === "duration")
      return isDurationInput(value) && durationSeconds(value) !== null;
    if (field.field_type === "boolean" || field.field_type === "checkbox")
      return typeof value === "boolean";
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === "string" && value.trim().length > 0;
  });
}

/**
 * Check required values and reject invalid duration or link input before submitting.
 * @param fields The active field definitions.
 * @param values The current item form values.
 * @returns Whether the form can be safely converted into a complete replacement payload.
 */
export function hasValidItemValues(
  fields: InventoryField[],
  values: Record<string, InventoryItemFormValue>,
): boolean {
  return (
    hasRequiredItemValues(fields, values) &&
    fields.every((field) => {
      const value = values[field.id] ?? getInitialValue(field);
      if (field.field_type === "url")
        return (
          isUrlInput(value) &&
          (isWebAddress(value.url) ||
            (value.url === "" && !value.label?.trim()))
        );
      if (field.field_type !== "duration") return true;
      return (
        isDurationInput(value) &&
        (Object.values(value).every((part) => part === "") ||
          durationSeconds(value) !== null)
      );
    })
  );
}

/**
 * Restore a stored value without silently answering missing required yes/no fields.
 * @param field The field that determines the control and its default.
 * @param value The stored API value, which can be absent on older items.
 * @returns The correctly typed value for the item editing form.
 */
export function getEditableValue(
  field: InventoryField,
  value: unknown,
): InventoryItemFormValue {
  if (field.field_type === "duration") return durationFromSeconds(value);
  if (field.field_type === "url")
    return isUrlInput(value) ? { ...value } : { url: "", label: "" };
  if (field.field_type === "boolean" || field.field_type === "checkbox")
    return typeof value === "boolean" ? value : getInitialValue(field);
  if (field.field_type === "multiselect")
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  return value === null || value === undefined ? "" : String(value);
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
  // The server owns automatic IDs, including during complete item replacement.
  if (field.field_type === "id") return null;
  if (field.field_type === "url") {
    if (!isUrlInput(value) || !isWebAddress(value.url)) return null;
    return {
      field_id: field.id,
      value: { url: value.url, ...(value.label && { label: value.label }) },
    };
  }
  if (field.field_type === "boolean" || field.field_type === "checkbox") {
    return typeof value === "boolean" ? { field_id: field.id, value } : null;
  }

  if (field.field_type === "duration") {
    const seconds = isDurationInput(value) ? durationSeconds(value) : null;
    return seconds === null ? null : { field_id: field.id, value: seconds };
  }

  if (Array.isArray(value)) {
    return value.length ? { field_id: field.id, value } : null;
  }

  if (typeof value !== "string" || !value) {
    return null;
  }

  if (field.field_type === "number") {
    return { field_id: field.id, value: Number(value) };
  }

  return { field_id: field.id, value };
}

/**
 * Toggle one checkbox using full replacement without coercing any other stored values.
 * @param fields The active definitions, excluding removed fields from the payload.
 * @param item The complete saved item whose editable values must be retained.
 * @param fieldId The checkbox field being changed.
 * @param checked The requested checked state, including explicit false.
 * @returns The complete replacement payload without server-owned automatic IDs.
 */
export function createCheckboxReplacement(
  fields: InventoryField[],
  item: InventoryItem,
  fieldId: string,
  checked: boolean,
): InventoryItemInput {
  const values = fields.flatMap((field) => {
    if (field.field_type === "id") return [];
    if (field.id === fieldId) return [{ field_id: field.id, value: checked }];
    const stored = item.values.find((value) => value.field_id === field.id);
    // Required checkbox controls have an explicit unchecked default, just like the edit dialog.
    if (!stored && field.field_type === "checkbox" && field.is_required)
      return [{ field_id: field.id, value: false }];
    return stored ? [{ field_id: field.id, value: stored.value }] : [];
  });
  return { values };
}
