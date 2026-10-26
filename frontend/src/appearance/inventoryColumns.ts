import type { InventoryField } from "../types/inventoryField";

export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 1200;
// Preserve existing preferences from earlier width handling when reading legacy data.
export const MAX_STORED_COLUMN_WIDTH = 32768;
const MAX_DEFAULT_CONTENT_WIDTH = 320;

// Measure header and value text separately because their typography differs.
export type ColumnTextMeasure = (text: string, header: boolean) => number;

// Keep server-side rendering and DOM-only tests usable without a canvas implementation.
const estimateText: ColumnTextMeasure = (text, header) =>
  Array.from(text).length * (header ? 8 : 7);

/**
 * Fit the heading and displayed values, limiting the influence of long contents.
 * @param field The field name, type, and sorting preference.
 * @param values The formatted values shown in this column.
 * @param measure The font-aware text measurement, with an estimate as fallback.
 * @returns The default width in pixels, including padding and sort-indicator space.
 */
export function defaultColumnWidth(
  field: Pick<InventoryField, "name" | "field_type" | "is_sortable">,
  values: string[],
  measure: ColumnTextMeasure = estimateText,
): number {
  // Include a small rounding margin so short labels do not turn into an ellipsis.
  const heading =
    measure(field.name.toLocaleUpperCase(), true) +
    (field.is_sortable ? 40 : 24) +
    4;
  let content = field.field_type === "checkbox" ? 16 : 0;
  if (field.field_type !== "checkbox") {
    for (const value of values) {
      for (const line of value.split(/\r?\n/u)) {
        content = Math.max(content, measure(line, false));
        if (content + 24 >= MAX_DEFAULT_CONTENT_WIDTH) break;
      }
      if (content + 24 >= MAX_DEFAULT_CONTENT_WIDTH) break;
    }
  }
  return clampColumnWidth(
    Math.ceil(
      Math.max(heading, Math.min(content + 24, MAX_DEFAULT_CONTENT_WIDTH)),
    ),
  );
}

/**
 * Distribute temporary surplus to Auto columns, or all columns if none are Auto.
 * @param widths The automatic or saved base widths of visible data columns.
 * @param availableWidth The data viewport width, excluding the action pane.
 * @param automatic Whether each visible column has no manual width override.
 * @returns Display widths without changing or saving the supplied base widths.
 */
export function distributeColumnWidths(
  widths: number[],
  availableWidth: number,
  automatic: boolean[],
): number[] {
  if (widths.length === 0) return [];
  const extra = Math.floor(
    Math.max(0, availableWidth - widths.reduce((sum, width) => sum + width, 0)),
  );
  let targets = widths
    .map((_, index) => index)
    .filter((index) => automatic[index]);
  if (targets.length === 0) targets = widths.map((_, index) => index);
  const result = widths.slice();
  const share = Math.floor(extra / targets.length);
  const remainder = extra % targets.length;
  targets.forEach((index, position) => {
    result[index] += share + (position < remainder ? 1 : 0);
  });
  return result;
}

/**
 * Constrain a user-selected column width to a usable whole-pixel range.
 * @param width The requested width in pixels.
 * @returns A finite width between the minimum and maximum.
 */
export function clampColumnWidth(width: number): number {
  return Number.isFinite(width)
    ? Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)))
    : MIN_COLUMN_WIDTH;
}
