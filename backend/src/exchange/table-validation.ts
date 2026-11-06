import { z } from "zod";
import { fieldCreateSchema } from "../fields/validation.js";
import { validateValues } from "../items/validation.js";
import { urlValueSchema } from "../items/url.js";
import { nameSchema } from "../validation/common.js";
import { caseFold } from "../validation/case-folding.js";
import { DomainError } from "../errors.js";
import type { InventoryManifest } from "./manifest.js";
import { maxTableColumns, type InventoryTable } from "./table-reader.js";

// Source IDs may be mapped to numbers; attachments and automatic ID allocation require inventory-specific data.
const tableFieldTypes = [
  "text",
  "number",
  "boolean",
  "checkbox",
  "date",
  "time",
  "datetime",
  "duration",
  "url",
  "select",
  "multiselect",
] as const;
export const tableColumnMappingsSchema = z
  .array(
    z.strictObject({
      column: z
        .number()
        .int()
        .min(0)
        .max(maxTableColumns - 1),
      name: nameSchema,
      field_type: z.enum(tableFieldTypes),
      // Literal cell separator, independent of the CSV file delimiter; omission selects semicolon.
      separator: z.string().min(1).max(16).optional(),
    }),
  )
  .min(1)
  .max(maxTableColumns)
  .superRefine((mappings, context) => {
    const columns = new Set<number>();
    for (const [index, mapping] of mappings.entries()) {
      if (columns.has(mapping.column))
        context.addIssue({
          code: "custom",
          path: [index, "column"],
          message: "A source column can only be mapped once.",
        });
      columns.add(mapping.column);
      if (
        mapping.separator !== undefined &&
        mapping.field_type !== "multiselect"
      )
        context.addIssue({
          code: "custom",
          path: [index, "separator"],
          message: "Only multiple-choice columns use a cell separator.",
        });
    }
  });
export type TableColumnMapping = z.output<
  typeof tableColumnMappingsSchema
>[number];
type Field = InventoryManifest["fields"][number];
type IssueCode =
  | "invalid_value"
  | "invalid_option_name"
  | "conflicting_option_name"
  | "too_many_options"
  | "missing_options";

// Coordinates refer to zero-based source data rows and columns, including columns skipped by other mappings.
export interface TableValidationIssue {
  row?: number;
  column: number;
  code: IssueCode;
}
export type TableValidationResult =
  | { valid: false; issues: TableValidationIssue[] }
  | {
      valid: true;
      issues: [];
      fields: InventoryManifest["fields"];
      items: InventoryManifest["items"];
    };

class InvalidTableValue extends Error {
  constructor(readonly code: IssueCode = "invalid_value") {
    super(code);
  }
}

/**
 * Convert a scalar cell after an explicit type choice, retaining untouched text as entered.
 * @param text The original cell, including meaningful text whitespace.
 * @param type The requested field type; numbers use decimal points and booleans use true/false.
 * @returns A candidate domain value, or undefined for an empty optional cell.
 */
function scalarValue(
  text: string,
  type: TableColumnMapping["field_type"],
): unknown {
  if (text === "") return undefined;
  if (type === "text") return text;
  const source = text.trim();
  if (!source) return undefined;
  if (type === "number" || type === "duration") {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(source))
      throw new InvalidTableValue();
    return Number(source);
  }
  if (type === "boolean" || type === "checkbox") {
    if (source !== "true" && source !== "false") throw new InvalidTableValue();
    return source === "true";
  }
  if (type === "url") {
    if (urlValueSchema.safeParse({ url: source }).success)
      return { url: source };
    const link =
      /^\[([\s\S]+)\]\((https?:\/\/\S+)\)$/iu.exec(text) ??
      /^([\s\S]+) \((https?:\/\/\S+)\)$/iu.exec(text);
    if (!link) throw new InvalidTableValue();
    return { label: link[1]!, url: link[2]! };
  }
  return source;
}

/**
 * Derive choices from literal cell text, using only the user-selected multiselect separator.
 * @param text The raw cell; single-choice names are never split.
 * @param field The destination field collecting first-seen named options.
 * @param separator Literal substring separating multiple choices, defaulting to semicolon.
 * @param names Exact normalized option names and their local portable keys.
 * @param folded Case-folded names for ordinary field-name conflict detection.
 * @returns Ordered option keys; empty fragments and repeated choices are omitted.
 */
function selectionValue(
  text: string,
  field: Field,
  separator: string,
  names: Map<string, string>,
  folded: Map<string, string>,
): string | string[] | undefined {
  if (!text.trim()) return undefined;
  const selected =
    field.field_type === "multiselect" ? text.split(separator) : [text];
  const pending = new Map<string, string>();
  const normalized = new Set<string>();
  for (const candidate of selected) {
    if (!candidate.trim()) continue;
    const parsed = nameSchema.safeParse(candidate);
    if (!parsed.success) throw new InvalidTableValue("invalid_option_name");
    const name = parsed.data;
    const key = caseFold(name);
    const existing = folded.get(key) ?? pending.get(key);
    if (existing !== undefined && existing !== name)
      throw new InvalidTableValue("conflicting_option_name");
    if (existing === undefined) pending.set(key, name);
    normalized.add(name);
  }
  if (names.size + pending.size > 100)
    throw new InvalidTableValue("too_many_options");
  // Commit inferred names only after the whole cell has passed option validation.
  for (const [key, name] of pending) {
    const option = `o${field.key}_${names.size + 1}`;
    names.set(name, option);
    folded.set(key, name);
    field.options.push({ key: option, available: true, name });
  }
  const keys = [...normalized].map((name) => names.get(name)!);
  return field.field_type === "multiselect"
    ? keys.length
      ? keys
      : undefined
    : keys[0];
}

/**
 * Check all rows against explicit field mappings independently of file parsing or database publication.
 * @param table The bounded rectangular table produced by the file reader.
 * @param input Mapped field definitions; omitted source columns are skipped.
 * @returns All source cell errors, or typed portable fields/items in source order for later publication.
 * @throws {z.ZodError} If field names, mapping settings or source-column references are invalid.
 */
export function validateTableMapping(
  table: InventoryTable,
  input: unknown,
): TableValidationResult {
  const mappings = tableColumnMappingsSchema
    .superRefine((columns, context) => {
      for (const [index, column] of columns.entries())
        if (column.column >= table.headers.length)
          context.addIssue({
            code: "custom",
            path: [index, "column"],
            message: "The mapped source column does not exist.",
          });
    })
    .parse(input)
    .sort((left, right) => left.column - right.column);
  const issues: TableValidationIssue[] = [];
  const fields: Field[] = [];
  const items: InventoryManifest["items"] = table.rows.map((_, index) => ({
    key: `i${index + 1}`,
    values: [],
  }));
  for (const mapping of mappings) {
    const field: Field = {
      key: `f${mapping.column + 1}`,
      name: mapping.name,
      field_type: mapping.field_type,
      max_length: mapping.field_type === "text" ? 1_000 : null,
      is_required: false,
      is_sortable: true,
      reuse_deleted_ids: false,
      last_assigned_id: 0,
      options: [],
    };
    const names = new Map<string, string>();
    const folded = new Map<string, string>();
    const selection =
      field.field_type === "select" || field.field_type === "multiselect";
    for (const [row, cells] of table.rows.entries()) {
      try {
        const value = selection
          ? selectionValue(
              cells[mapping.column]!,
              field,
              mapping.separator ?? ";",
              names,
              folded,
            )
          : scalarValue(cells[mapping.column]!, mapping.field_type);
        if (value === undefined) continue;
        validateValues(
          [{ field_id: field.key, value }],
          [
            {
              id: field.key,
              fieldType: field.field_type,
              maxLength: field.max_length,
              isRequired: false,
            },
          ],
          field.options.map((option) => ({
            id: option.key,
            fieldId: field.key,
          })),
        );
        items[row]!.values.push({ field: field.key, value });
      } catch (error) {
        if (error instanceof InvalidTableValue)
          issues.push({ row, column: mapping.column, code: error.code });
        else if (
          error instanceof DomainError &&
          error.code === "invalid_inventory_item_value"
        )
          issues.push({ row, column: mapping.column, code: "invalid_value" });
        else throw error;
      }
    }
    if (selection && !field.options.length)
      issues.push({ column: mapping.column, code: "missing_options" });
    else
      fieldCreateSchema.parse({
        name: field.name,
        field_type: field.field_type,
        ...(field.max_length === null ? {} : { max_length: field.max_length }),
        options: field.options.map((option) => ({ name: option.name })),
      });
    fields.push(field);
  }
  issues.sort(
    (left, right) =>
      (left.row ?? -1) - (right.row ?? -1) || left.column - right.column,
  );
  return issues.length
    ? { valid: false, issues }
    : { valid: true, issues: [], fields, items };
}
