import type { InventoryField } from "../types/inventoryField";
import { isUrlInput, urlDisplayText } from "./url";

/**
 * Convert a stored calendar or ISO week date to a UTC timestamp.
 * @param value The stored date string.
 * @returns The timestamp or NaN for an unsupported date.
 */
function dateValue(value: string): number {
  const calendar = /^(\d{4})-?(\d{2})-?(\d{2})$/u.exec(value);
  const week = /^(\d{4})-?W(\d{2})(?:-?([1-7]))?$/u.exec(value);
  const date = new Date(0);
  if (calendar) {
    date.setUTCFullYear(
      Number(calendar[1]),
      Number(calendar[2]) - 1,
      Number(calendar[3]),
    );
    return date.getTime();
  }
  if (week) {
    date.setUTCFullYear(Number(week[1]), 0, 4);
    date.setUTCDate(
      4 -
        ((date.getUTCDay() || 7) - 1) +
        (Number(week[2]) - 1) * 7 +
        Number(week[3] ?? 1) -
        1,
    );
    return date.getTime();
  }
  return NaN;
}

/**
 * Convert a stored time to seconds, accounting for an explicit UTC offset.
 * @param value The stored time string.
 * @returns The time in seconds or NaN for an unsupported value.
 */
function timeValue(value: string): number {
  const parts =
    /^T?(\d{2})(?::?(\d{2}))?(?::?(\d{2})(?:[.,](\d+))?)?(Z|[+-].+)?$/u.exec(
      value,
    );
  if (!parts) return NaN;
  const seconds =
    Number(parts[1]) * 3600 +
    Number(parts[2] ?? 0) * 60 +
    Number(parts[3] ?? 0) +
    Number(`0.${parts[4] ?? "0"}`);
  const offset = parts[5];
  if (!offset || offset === "Z") return seconds;
  return (
    seconds - (offset.startsWith("-") ? -1 : 1) * timeValue(offset.slice(1))
  );
}

/**
 * Build a comparable value using field semantics and option labels.
 * @param field The column definition.
 * @param value The stored field value.
 * @param collator The locale-aware text comparator.
 * @returns A numeric or textual sort key, or null for an empty value.
 */
export function comparableItemValue(
  field: InventoryField,
  value: unknown,
  collator: Intl.Collator,
): string | number | null {
  if (field.field_type === "url")
    return isUrlInput(value) ? urlDisplayText(value) || null : null;
  if (
    value == null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  )
    return null;
  if (typeof value === "number" || typeof value === "boolean")
    return Number(value);
  const optionLabel = (id: string) =>
    field.options.find((option) => option.id === id)?.name ?? id;
  if (field.field_type === "select") return optionLabel(String(value));
  if (field.field_type === "multiselect" && Array.isArray(value)) {
    return value.map(String).map(optionLabel).sort(collator.compare).join(", ");
  }
  const text = String(value);
  if (field.field_type === "date") {
    const timestamp = dateValue(text);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  if (field.field_type === "time") {
    const seconds = timeValue(text);
    if (Number.isFinite(seconds)) return seconds;
  }
  if (field.field_type === "datetime") {
    const date =
      /^(\d{4}-\d{2}-\d{2}|\d{8}|\d{4}-W\d{2}(?:-[1-7])?|\d{4}W\d{2}[1-7]?)/u.exec(
        text,
      )?.[0];
    if (date) {
      // Treat local datetimes consistently without depending on the host timezone.
      const clock = Array.from(text.slice(date.length)).slice(1).join("");
      const timestamp = dateValue(date) + (clock ? timeValue(clock) * 1000 : 0);
      if (Number.isFinite(timestamp)) return timestamp;
    }
  }
  return text;
}
