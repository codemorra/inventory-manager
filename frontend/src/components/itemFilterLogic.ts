import type {
  InventoryField,
  InventoryFieldType,
} from "../types/inventoryField";
import type { InventoryItem } from "../types/inventoryItem";
import type { ItemFilter, ItemFilterOperator } from "../types/itemFilter";
import { comparableItemValue } from "./inventoryItemComparison";
import { durationSeconds, emptyDuration, type DurationInput } from "./duration";
import { isUrlInput } from "./url";

const emptyOperators: ItemFilterOperator[] = ["isEmpty", "isNotEmpty"];
const collator = new Intl.Collator("en");

/**
 * List supported conditions for a field without offering incompatible comparisons.
 * @param type The inventory field type.
 * @returns Operators in their dropdown order.
 */
export function itemFilterOperators(
  type: InventoryFieldType,
): ItemFilterOperator[] {
  let operators: ItemFilterOperator[];
  switch (type) {
    case "attachment":
      return emptyOperators;
    case "text":
    case "url":
      operators = ["contains", "notContains", "equals", "notEquals"];
      break;
    case "boolean":
    case "checkbox":
      operators = ["isTrue", "isFalse"];
      break;
    case "select":
    case "multiselect":
      operators = ["anyOf", "noneOf"];
      break;
    case "date":
    case "time":
    case "datetime":
      operators = ["equals", "notEquals", "before", "after", "between"];
      break;
    default:
      operators = [
        "equals",
        "notEquals",
        "greaterThan",
        "atLeast",
        "lessThan",
        "atMost",
        "between",
      ];
  }
  return [...operators, ...emptyOperators];
}

/**
 * Restore partially entered duration components without discarding empty segments.
 * @param value The colon-separated hours, minutes, and seconds from the filter draft.
 * @returns The duration control's editable components.
 */
export function filterDurationInput(value: string): DurationInput {
  if (!value) return emptyDuration();
  const [hours = "", minutes = "", seconds = ""] = value.split(":");
  return { hours, minutes, seconds };
}

/**
 * Parse a filter operand strictly, independently of the browser's input validation.
 * @param field The field supplying comparison semantics.
 * @param value The user's draft operand.
 * @returns Its numeric comparison key, or null when invalid or missing.
 */
function operandValue(field: InventoryField, value: string): number | null {
  if (!value.trim()) return null;
  if (field.field_type === "duration") {
    if (value.split(":").length !== 3) return null;
    return durationSeconds(filterDurationInput(value));
  }
  if (field.field_type === "number" || field.field_type === "id") {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return field.field_type === "id" &&
      (!Number.isSafeInteger(number) || number < 1)
      ? null
      : number;
  }
  const validDate = (text: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return false;
    const date = new Date(`${text}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === text
    );
  };
  const validTime = (text: string) => {
    const parts = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/u.exec(text);
    return (
      !!parts &&
      Number(parts[1]) < 24 &&
      Number(parts[2]) < 60 &&
      Number(parts[3] ?? 0) < 60
    );
  };
  if (field.field_type === "date" && !validDate(value)) return null;
  if (field.field_type === "time" && !validTime(value)) return null;
  if (field.field_type === "datetime") {
    const parts = value.split("T");
    if (parts.length !== 2 || !validDate(parts[0]) || !validTime(parts[1]))
      return null;
  }
  const result = comparableItemValue(field, value, collator);
  return typeof result === "number" && Number.isFinite(result) ? result : null;
}

/**
 * Validate a draft before applying it, including fields/options changed in the background.
 * @param filter The candidate condition.
 * @param fields The current inventory field definitions.
 * @returns The translated-error key suffix, or null for a valid condition.
 */
export function itemFilterError(
  filter: ItemFilter,
  fields: InventoryField[],
): "field" | "value" | "range" | "options" | null {
  const field = fields.find((entry) => entry.id === filter.fieldId);
  if (
    !field ||
    field.field_type !== filter.fieldType ||
    !itemFilterOperators(field.field_type).includes(filter.operator)
  )
    return "field";
  if ([...emptyOperators, "isTrue", "isFalse"].includes(filter.operator))
    return null;
  if (filter.operator === "anyOf" || filter.operator === "noneOf")
    return filter.optionIds.length > 0 &&
      filter.optionIds.every((id) =>
        field.options.some((option) => option.id === id),
      )
      ? null
      : "options";
  if (field.field_type === "text" || field.field_type === "url")
    return filter.value.trim() ? null : "value";
  const first = operandValue(field, filter.value);
  if (first === null) return "value";
  if (filter.operator !== "between") return null;
  const last = operandValue(field, filter.valueTo);
  if (last === null) return "value";
  return first > last ? "range" : null;
}

/**
 * Identify empty cells without treating zero, false, or an unchecked box as missing.
 * @param value The stored field value.
 * @returns Whether the value has no user-facing contents.
 */
function isEmpty(value: unknown): boolean {
  return (
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (isUrlInput(value) && !value.url.trim() && !value.label?.trim())
  );
}

/**
 * Apply validated field conditions with AND; selected options within one row use OR.
 * @param items Items already narrowed by text search, still in their source order.
 * @param fields All fields, including hidden columns.
 * @param filters Applied conditions; obsolete or invalid conditions are ignored safely.
 * @param locale The language used for case-insensitive text comparisons.
 * @returns Matching items without mutating the input or its values.
 */
export function filterInventoryItems(
  items: InventoryItem[],
  fields: InventoryField[],
  filters: ItemFilter[],
  locale: string,
): InventoryItem[] {
  const active = filters
    .filter((filter) => !itemFilterError(filter, fields))
    .map((filter) => ({
      filter,
      field: fields.find((field) => field.id === filter.fieldId)!,
    }));
  if (!active.length) return items;
  const normalize = (text: string) =>
    text.trim().normalize("NFC").toLocaleLowerCase(locale);
  return items.filter((item) => {
    const values = new Map(
      item.values.map((entry) => [entry.field_id, entry.value]),
    );
    return active.every(({ filter, field }) => {
      const value = values.get(field.id);
      const empty = isEmpty(value);
      if (filter.operator === "isEmpty") return empty;
      if (filter.operator === "isNotEmpty") return !empty;
      // Missing values require an explicit empty condition, including for negative comparisons.
      if (empty) return false;
      if (filter.operator === "isTrue") return value === true;
      if (filter.operator === "isFalse") return value === false;
      if (filter.operator === "anyOf" || filter.operator === "noneOf") {
        const selected = Array.isArray(value) ? value : [value];
        const matches = filter.optionIds.some((id) => selected.includes(id));
        return filter.operator === "anyOf" ? matches : !matches;
      }
      if (field.field_type === "text" || field.field_type === "url") {
        const texts = isUrlInput(value)
          ? [value.url, value.label ?? ""]
          : typeof value === "string"
            ? [value]
            : [];
        const needle = normalize(filter.value);
        const matches = texts.some((text) =>
          filter.operator === "contains" || filter.operator === "notContains"
            ? normalize(text).includes(needle)
            : normalize(text) === needle,
        );
        return filter.operator === "notContains" ||
          filter.operator === "notEquals"
          ? !matches
          : matches;
      }
      const actual = comparableItemValue(field, value, collator);
      const expected = operandValue(field, filter.value);
      if (
        typeof actual !== "number" ||
        !Number.isFinite(actual) ||
        expected === null
      )
        return false;
      switch (filter.operator) {
        case "equals":
          return actual === expected;
        case "notEquals":
          return actual !== expected;
        case "greaterThan":
        case "after":
          return actual > expected;
        case "atLeast":
          return actual >= expected;
        case "lessThan":
        case "before":
          return actual < expected;
        case "atMost":
          return actual <= expected;
        case "between": {
          const last = operandValue(field, filter.valueTo);
          return last !== null && actual >= expected && actual <= last;
        }
        default:
          return false;
      }
    });
  });
}
