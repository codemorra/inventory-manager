import type { InventoryField } from "../types/inventoryField";
import type { InventoryItem } from "../types/inventoryItem";
import type { InventoryAttachment } from "../types/inventoryItem";
import { formatDuration } from "./duration";
import { isUrlInput } from "./url";

// Resolve language-dependent values without searching technical item or option IDs.
export interface ItemSearchLabels {
  yes: string;
  no: string;
}

/**
 * Select searchable user-facing text without coercing malformed structured values.
 * @param field The field defining how its stored value is interpreted.
 * @param value The stored item value, including missing values.
 * @param labels The translated boolean labels.
 * @param locale The language used to display durations.
 * @returns Searchable text fragments; empty values have no placeholder text.
 */
function searchTexts(
  field: InventoryField,
  value: unknown,
  labels: ItemSearchLabels,
  locale: string,
  attachments: InventoryAttachment[],
): string[] {
  if (value == null || value === "") return [];
  if (field.field_type === "attachment")
    return Array.isArray(value)
      ? attachments
          .filter(
            (file) => file.field_id === field.id && value.includes(file.id),
          )
          .map((file) => file.filename)
      : [];
  if (field.field_type === "url")
    return isUrlInput(value) ? [value.url, value.label ?? ""] : [];
  if (field.field_type === "select" || field.field_type === "multiselect") {
    const ids = Array.isArray(value) ? value : [value];
    return field.options
      .filter((option) => ids.includes(option.id))
      .map((option) => option.name);
  }
  if (typeof value === "boolean") return [value ? labels.yes : labels.no];
  if (field.field_type === "duration" && typeof value === "number")
    return [formatDuration(value, locale)];
  return typeof value === "string" || typeof value === "number"
    ? [String(value)]
    : [];
}

/**
 * Search all configured fields, preserving source order and hidden-column matches.
 * @param items The complete inventory items in their original order.
 * @param fields All current fields, independently of table visibility.
 * @param query A literal substring, ignoring case and surrounding whitespace.
 * @param labels The translated boolean labels.
 * @param locale The application language for case folding and displayed durations.
 * @returns Matching items, or the original array when the search is blank.
 */
export function searchInventoryItems(
  items: InventoryItem[],
  fields: InventoryField[],
  query: string,
  labels: ItemSearchLabels,
  locale: string,
): InventoryItem[] {
  const normalize = (text: string) =>
    text.normalize("NFC").toLocaleLowerCase(locale);
  const needle = normalize(query.trim());
  if (!needle) return items;
  return items.filter((item) => {
    const values = new Map(
      item.values.map((value) => [value.field_id, value.value]),
    );
    return fields.some((field) =>
      searchTexts(
        field,
        values.get(field.id),
        labels,
        locale,
        item.attachments ?? [],
      ).some((text) => normalize(text).includes(needle)),
    );
  });
}
