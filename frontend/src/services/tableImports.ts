import { request } from "./api";
import type { Inventory } from "../types/inventory";
import type {
  CsvDelimiter,
  TableColumnMapping,
  TableImportFormat,
  TableImportInput,
  TableImportPreview,
  TableImportRows,
  TableImportValidation,
} from "../types/tableImport";

const path = (id: string) =>
  `/inventory-table-imports/${encodeURIComponent(id)}`;

/** Stream the original table file with explicit parsing settings, without browser-side CSV/Markdown decoding. */
export function prepareTableImport(
  file: File,
  format: TableImportFormat,
  delimiter: CsvDelimiter,
  signal?: AbortSignal,
): Promise<TableImportPreview> {
  const query = new URLSearchParams({
    format,
    ...(format === "csv" ? { delimiter } : {}),
  });
  return request(`/inventory-table-imports?${query}`, {
    method: "POST",
    headers: {
      "Content-Type": format === "csv" ? "text/csv" : "text/markdown",
    },
    body: file,
    ...(signal ? { signal } : {}),
  });
}

/** Fetch a bounded page retaining original row and column coordinates, including skipped columns. */
export function readTableImportRows(
  id: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<TableImportRows> {
  const query = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });
  return request(`${path(id)}/rows?${query}`, {
    ...(signal ? { signal } : {}),
  });
}

/** Check every source row against the current explicit interpretation without saving any data. */
export function validateTableImport(
  id: string,
  columns: TableColumnMapping[],
  signal?: AbortSignal,
): Promise<TableImportValidation> {
  return request(`${path(id)}/validate`, {
    method: "POST",
    body: JSON.stringify({ columns }),
    ...(signal ? { signal } : {}),
  });
}

/** Publish the captured mapping and metadata, retaining identical retry parameters after uncertain responses. */
export function confirmTableImport(
  id: string,
  data: TableImportInput,
): Promise<Inventory> {
  return request(`${path(id)}/confirm`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Read authoritative confirmation status without repeating publication. */
export function readTableImport(id: string): Promise<TableImportPreview> {
  return request(path(id));
}

/** Discard a ready preview or completed receipt; imported inventories remain intact. */
export function discardTableImport(id: string): Promise<void> {
  return request(path(id), { method: "DELETE" });
}
