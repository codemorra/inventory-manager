import type {
  TableColumnMapping,
  TableFieldType,
  TableValidationIssue,
} from "../types/tableImport";
import { ApiError } from "../services/api";

export const tableFieldTypes: TableFieldType[] = [
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
];
export const tableImportPageSize = 50;
export const tableImportColumnWidth = 256;
export interface TableColumnDraft {
  column: number;
  name: string;
  field_type: TableFieldType | "skip";
  separator: string;
}

/** Retain only selected fields and their relevant settings in the captured interpretation. */
export function mappedTableColumns(
  columns: TableColumnDraft[],
): TableColumnMapping[] {
  return columns
    .filter((column) => column.field_type !== "skip")
    .map((column) => ({
      column: column.column,
      name: column.name.trim(),
      field_type: column.field_type as TableFieldType,
      ...(column.field_type === "multiselect"
        ? { separator: column.separator }
        : {}),
    }));
}

/** Check editable mapping settings before asking the backend to validate every source cell. */
export function validTableColumns(columns: TableColumnDraft[]): boolean {
  const mapped = mappedTableColumns(columns);
  return (
    mapped.length > 0 &&
    mapped.every(
      (column) =>
        column.name.length > 0 &&
        Array.from(column.name).length <= 255 &&
        (column.field_type !== "multiselect" ||
          (!!column.separator && column.separator.length <= 16)),
    )
  );
}

/** Give error navigation a stable focus target in the source grid or its column controls. */
export function tableIssueId(
  id: string,
  issue: Pick<TableValidationIssue, "row" | "column">,
): string {
  return issue.row === undefined
    ? `${id}-type-${issue.column}`
    : `${id}-cell-${issue.row}-${issue.column}`;
}

/** Select localized table errors without exposing parser internals or backend English messages. */
export function tableImportErrorKey(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  const keys: Record<string, string> = {
    invalid_csv: "tableImports.invalidCsv",
    invalid_markdown_table: "tableImports.singleTable",
    inconsistent_table_columns: "tableImports.inconsistentColumns",
    empty_table: "tableImports.emptyTable",
    invalid_table_encoding: "tableImports.invalidEncoding",
    table_too_large: "tableImports.tooLarge",
    inventory_import_not_found: "tableImports.expired",
    inventory_group_not_found: "archives.groupMissing",
    invalid_inventory_table_values: "tableImports.invalidValues",
  };
  return (
    keys[error.code ?? ""] ??
    (error.status === 422 ? "tableImports.invalidSettings" : fallback)
  );
}
