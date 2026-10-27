import type { InventoryField } from "../types/inventoryField";
import type {
  InventoryItem,
  InventoryItemValueInput,
  UpdateInventoryItemsInput,
} from "../types/inventoryItem";
import {
  createValueInput,
  getEditableValue,
  type InventoryItemFormValue,
} from "./inventoryItemForm";
import { durationSeconds, isDurationInput } from "./duration";
import { isUrlInput, isWebAddress } from "./url";

// Changes contain only deliberately edited cells; untouched values retain their API representation.
export type TableCellChanges = Record<
  string,
  Record<string, InventoryItemFormValue>
>;
export interface TableCellError {
  itemId: string;
  fieldId: string;
  error:
    | "required"
    | "number"
    | "text"
    | "options"
    | "attachment"
    | "url"
    | "duration"
    | "temporal";
}

/**
 * Preserve an unset Yes/No value instead of silently displaying or saving No.
 * @param field The field supplying form semantics.
 * @param original The stored value, if present.
 * @returns The table cell's initial editable value.
 */
export function getTableCellValue(
  field: InventoryField,
  original: unknown,
): InventoryItemFormValue {
  return field.field_type === "boolean" && typeof original !== "boolean"
    ? ""
    : getEditableValue(field, original);
}

/**
 * Compare draft and baseline values without turning absent cells into implicit defaults.
 * @param field The column defining form conversion.
 * @param original The stored API value, if present.
 * @param edited The user's current form value.
 * @returns Whether the cell can be removed from the change set.
 */
export function unchangedTableCell(
  field: InventoryField,
  original: unknown,
  edited: InventoryItemFormValue,
): boolean {
  const baseline = getTableCellValue(field, original);
  if (JSON.stringify(baseline) === JSON.stringify(edited)) return true;
  const converted = createValueInput(field, edited)?.value;
  // Compare representations only after validating conversion, avoiding invalid durations/URLs as clears.
  if (
    field.field_type === "number" &&
    typeof edited === "string" &&
    edited.trim() &&
    tableCellError(field, edited, true) === null
  )
    return original === Number(edited);
  if (
    field.field_type === "duration" &&
    isDurationInput(edited) &&
    durationSeconds(edited) !== null
  )
    return original === converted;
  if (
    field.field_type === "multiselect" &&
    Array.isArray(original) &&
    Array.isArray(edited)
  )
    return (
      JSON.stringify([...original].sort()) ===
      JSON.stringify([...edited].sort())
    );
  return false;
}

/**
 * Validate the standard calendar/clock formats accepted by editable native controls.
 * @param type The temporal field type.
 * @param value The entered string; untouched legacy ISO values bypass this frontend-only check.
 * @returns Whether the operand is a valid local calendar/clock value.
 */
export function validEditedTemporal(type: string, value: string): boolean {
  const date = (text: string) => {
    if (
      !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(text) ||
      Number(text.slice(0, 4)) < 1
    )
      return false;
    const parsed = new Date(`${text}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === text
    );
  };
  const time = (text: string) => {
    const parts = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/u.exec(text);
    return (
      !!parts &&
      Number(parts[1]) < 24 &&
      Number(parts[2]) < 60 &&
      Number(parts[3] ?? 0) < 60
    );
  };
  if (type === "date") return date(value);
  if (type === "time") return time(value);
  const parts = value.split("T");
  return parts.length === 2 && date(parts[0]) && time(parts[1]);
}

/**
 * Validate one cell without silently dropping invalid input during payload conversion.
 * @param field The snapshot's field definition and available options.
 * @param value The current form value.
 * @param edited Whether the user changed this cell rather than preserving stored content.
 * @returns The localized-error suffix, or null when valid.
 */
export function tableCellError(
  field: InventoryField,
  value: InventoryItemFormValue,
  edited: boolean,
): TableCellError["error"] | null {
  if (field.field_type === "id") return null;
  const empty =
    value === "" ||
    (Array.isArray(value) && !value.length) ||
    (isUrlInput(value) && value.url === "" && !value.label?.trim()) ||
    (isDurationInput(value) &&
      Object.values(value).every((part) => part === ""));
  if (empty) return field.is_required ? "required" : null;
  if (field.is_required && typeof value === "string" && !value.trim())
    return "required";
  switch (field.field_type) {
    case "attachment":
      return Array.isArray(value) &&
        value.every((id) => typeof id === "string" && id.length > 0) &&
        new Set(value).size === value.length
        ? null
        : "attachment";
    case "number":
      return typeof value === "string" &&
        value.trim() !== "" &&
        Number.isFinite(Number(value)) &&
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value.trim())
        ? null
        : "number";
    case "text":
      return typeof value === "string" &&
        Array.from(value).length <= (field.max_length ?? 255)
        ? null
        : "text";
    case "boolean":
    case "checkbox":
      return typeof value === "boolean" ? null : "required";
    case "url":
      return isUrlInput(value) && isWebAddress(value.url) ? null : "url";
    case "duration":
      return isDurationInput(value) && durationSeconds(value) !== null
        ? null
        : "duration";
    case "select":
      return typeof value === "string" &&
        field.options.some((option) => option.id === value)
        ? null
        : "options";
    case "multiselect":
      return Array.isArray(value) &&
        value.every((id) => field.options.some((option) => option.id === id))
        ? null
        : "options";
    default:
      return !edited ||
        (typeof value === "string" &&
          validEditedTemporal(field.field_type, value))
        ? null
        : "temporal";
  }
}

/**
 * Assemble complete replacements for changed rows, preserving every untouched editable value.
 * @param fields The captured definitions, including hidden columns.
 * @param items The original item snapshots with their original revisions.
 * @param changes The deliberately edited cells.
 * @param configurationRevision The version captured with the field snapshot.
 * @returns Atomic replacement input and field-level validation errors.
 */
export function createTableReplacement(
  fields: InventoryField[],
  items: InventoryItem[],
  changes: TableCellChanges,
  configurationRevision: number,
): { input: UpdateInventoryItemsInput; errors: TableCellError[] } {
  const errors: TableCellError[] = [];
  const replacements = items
    .filter((item) => Object.keys(changes[item.id] ?? {}).length > 0)
    .map((item) => {
      const values: InventoryItemValueInput[] = [];
      for (const field of fields) {
        if (field.field_type === "id") continue;
        const stored = item.values.find((entry) => entry.field_id === field.id);
        const edited = Object.hasOwn(changes[item.id], field.id);
        const value = edited
          ? changes[item.id][field.id]
          : getTableCellValue(field, stored?.value);
        const error = tableCellError(field, value, edited);
        if (error) errors.push({ itemId: item.id, fieldId: field.id, error });
        if (edited) {
          const converted = createValueInput(field, value);
          if (converted) values.push(converted);
        } else if (stored)
          values.push({ field_id: field.id, value: stored.value });
        else if (field.field_type === "checkbox" && field.is_required)
          values.push({ field_id: field.id, value: false });
      }
      return { item_id: item.id, expected_revision: item.revision, values };
    });
  return {
    input: {
      expected_configuration_revision: configurationRevision,
      items: replacements,
    },
    errors,
  };
}
