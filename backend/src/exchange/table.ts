import type { InventoryManifest } from "./manifest.js";

export type TableExportFormat = "csv" | "markdown";
type Field = InventoryManifest["fields"][number];

/**
 * Flatten saved typed values without exposing technical option or attachment identities.
 * @param field The portable field definition and its available option names.
 * @param value The validated saved value, or undefined for an absent cell.
 * @returns Language-independent text: booleans, numeric seconds, original dates and readable links/options.
 */
function cellText(field: Field, value: unknown): string {
  if (value === undefined) return "";
  if (field.field_type === "select" || field.field_type === "multiselect") {
    const names = new Map(
      field.options.map((option) => [
        option.key,
        option.available ? option.name : "[unavailable]",
      ]),
    );
    const keys = Array.isArray(value) ? value : [value];
    return keys.map((key: string) => names.get(key)!).join("; ");
  }
  if (field.field_type === "url") {
    const link = value as { url: string; label?: string };
    return link.label ? `${link.label} (${link.url})` : link.url;
  }
  return String(value);
}

/**
 * Escape literal cell text for a Markdown pipe table without interpreting embedded HTML or formatting.
 * @param value The original header or rendered cell value.
 * @returns A single table-safe line, with original line breaks represented by HTML breaks.
 */
function markdownCell(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\`*_[\]{}()|~!#]/g, "\\$&")
    .replace(/\r\n|\r|\n/g, "<br>");
}

/**
 * Stream table rows in saved order; field metadata and attachment columns are omitted.
 * @param manifest The validated snapshot, with managed attachment fields already excluded.
 * @param format CSV uses comma-separated, quoted UTF-8 cells and CRLF; Markdown aligns escaped pipe-table cells to their column widths.
 * @returns Header and data lines without building a second whole-inventory string in memory.
 */
export function* tableExportLines(
  manifest: InventoryManifest,
  format: TableExportFormat,
): Generator<string> {
  const fields = manifest.fields;
  // Revisit the snapshot to measure escaped cells without retaining a second copy of every row.
  function* rows(): Generator<string[]> {
    yield fields.map((field) => field.name);
    for (const item of manifest.items) {
      const values = new Map(
        item.values.map((cell) => [cell.field, cell.value]),
      );
      yield fields.map((field) => cellText(field, values.get(field.key)));
    }
  }
  if (format === "csv") {
    for (const cells of rows())
      yield `${cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")}\r\n`;
    return;
  }
  const widths = fields.map(() => 3);
  for (const cells of rows())
    for (const [index, cell] of cells.entries())
      widths[index] = Math.max(widths[index]!, markdownCell(cell).length);
  let header = true;
  for (const cells of rows()) {
    yield `| ${cells.map((cell, index) => markdownCell(cell).padEnd(widths[index]!)).join(" | ")} |\n`;
    if (header) {
      yield `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |\n`;
      header = false;
    }
  }
}
