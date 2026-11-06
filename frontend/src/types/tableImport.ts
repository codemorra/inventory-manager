import type { CreateInventoryInput } from "./inventory";
import type { InventoryFieldType } from "./inventoryField";

export type TableImportFormat = "csv" | "markdown";
export type InventoryImportFormat = "zip" | TableImportFormat;
export type CsvDelimiter = "," | ";" | "\t";
export type TableFieldType = Exclude<InventoryFieldType, "id" | "attachment">;

// Table imports interpret foreign cell strings; they do not restore inventory metadata or managed files.
export interface TableImportPreview {
  id: string;
  expires_at: string;
  format: TableImportFormat;
  column_count: number;
  row_count: number;
  status: "ready" | "importing" | "completed";
  inventory_id?: string;
}
export interface TableImportRows {
  offset: number;
  limit: number;
  total_rows: number;
  headers: string[];
  rows: string[][];
}
export interface TableColumnMapping {
  column: number;
  name: string;
  field_type: TableFieldType;
  separator?: string;
}
export interface TableValidationIssue {
  row?: number;
  column: number;
  code:
    | "invalid_value"
    | "invalid_option_name"
    | "conflicting_option_name"
    | "too_many_options"
    | "missing_options";
}
export interface TableImportValidation {
  valid: boolean;
  issues: TableValidationIssue[];
}
export interface TableImportInput extends CreateInventoryInput {
  columns: TableColumnMapping[];
}
