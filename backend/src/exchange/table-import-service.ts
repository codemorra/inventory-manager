import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { inventories } from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";
import { DomainError } from "../errors.js";
import { inventoryCreateSchema } from "../inventories/validation.js";
import { createInventoryService } from "../inventories/service.js";
import { importSessionLifetime } from "./limits.js";
import { materializeInventory } from "./materialize.js";
import type { InventoryManifest } from "./manifest.js";
import {
  parseInventoryTable,
  maxTableBytes,
  TableParseError,
  type InventoryTable,
} from "./table-reader.js";
import {
  tableColumnMappingsSchema,
  validateTableMapping,
  type TableColumnMapping,
} from "./table-validation.js";

const prepareSchema = z.strictObject({
  format: z.enum(["csv", "markdown"]),
  delimiter: z.enum([",", ";", "\t"]).default(","),
});
const mappingSchema = z.strictObject({ columns: tableColumnMappingsSchema });
const confirmSchema = inventoryCreateSchema
  .extend({ columns: tableColumnMappingsSchema })
  .strict();
const pageSchema = z.strictObject({
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(200).default(50),
});
type Inventory = typeof inventories.$inferSelect;
interface TableSession {
  format: "csv" | "markdown";
  expires: number;
  columnCount: number;
  rowCount: number;
  table?: InventoryTable;
  request?: string;
  pending?: Promise<Inventory>;
  inventoryId?: string;
}

/** Normalize equivalent mapping requests before generating an idempotency signature. */
function normalizedColumns(columns: TableColumnMapping[]) {
  return columns
    .sort((left, right) => left.column - right.column)
    .map((column) => ({
      column: column.column,
      name: column.name,
      field_type: column.field_type,
      ...(column.field_type === "multiselect"
        ? { separator: column.separator ?? ";" }
        : {}),
    }));
}

/**
 * Retain bounded table previews without database writes or managed files until explicit confirmation.
 * @param db The destination database; publication shares the existing atomic snapshot materializer.
 * @returns Preparation, paged preview, validation, idempotent publication and session lifecycle operations.
 */
export function createTableImportService(db: AppDatabase) {
  const sessions = new Map<string, TableSession>();
  const missing = () =>
    new DomainError(
      "inventory_import_not_found",
      "The prepared table import is unavailable or expired. Select the file again.",
    );
  const busy = () =>
    new DomainError(
      "inventory_import_conflict",
      "This table import is already being confirmed or completed.",
    );
  function get(id: string): TableSession {
    const entry = sessions.get(id);
    if (!entry) throw missing();
    if (!entry.pending && entry.expires <= Date.now()) {
      sessions.delete(id);
      throw missing();
    }
    return entry;
  }
  function ready(entry: TableSession): InventoryTable {
    if (entry.pending || entry.inventoryId || !entry.table) throw busy();
    return entry.table;
  }
  const summary = (id: string, entry: TableSession) => ({
    id,
    expires_at: new Date(entry.expires).toISOString(),
    format: entry.format,
    column_count: entry.columnCount,
    row_count: entry.rowCount,
    status: entry.inventoryId
      ? ("completed" as const)
      : entry.pending
        ? ("importing" as const)
        : ("ready" as const),
    ...(entry.inventoryId ? { inventory_id: entry.inventoryId } : {}),
  });
  return {
    /**
     * Read a bounded binary table upload and check its structure without assigning field types.
     * @param content Original UTF-8 file stream; never a filesystem path or browser-generated JSON table.
     * @param input Explicit file format and optional CSV delimiter.
     * @param signal Cancellation from a disconnected uploading client.
     * @returns An expiring token and structural summary, without echoing the whole table.
     */
    async prepare(content: Readable, input: unknown, signal?: AbortSignal) {
      const options = prepareSchema.parse(input);
      signal?.throwIfAborted();
      const chunks: Buffer[] = [];
      let size = 0;
      await pipeline(
        content,
        new Writable({
          write(chunk: Buffer, _encoding, done) {
            size += chunk.length;
            if (size > maxTableBytes)
              done(new TableParseError("table_too_large"));
            else {
              chunks.push(chunk);
              done();
            }
          },
        }),
        { signal },
      );
      signal?.throwIfAborted();
      const table = parseInventoryTable(
        Buffer.concat(chunks, size),
        options.format,
        options.delimiter,
      );
      signal?.throwIfAborted();
      const id = randomUUID();
      const entry: TableSession = {
        format: options.format,
        table,
        expires: Date.now() + importSessionLifetime,
        columnCount: table.headers.length,
        rowCount: table.rows.length,
      };
      sessions.set(id, entry);
      return summary(id, entry);
    },
    async read(id: string) {
      return summary(id, get(id));
    },
    /**
     * Page immutable source rows so every original coordinate remains accessible in a bounded preview.
     * @param id The prepared table token.
     * @param input Zero-based row offset and bounded page length.
     * @returns Raw headers and cell strings; source row coordinates are independent of skipped columns.
     */
    async rows(id: string, input: unknown = {}) {
      const { offset, limit } = pageSchema.parse(input);
      const table = ready(get(id));
      return {
        offset,
        limit,
        total_rows: table.rows.length,
        headers: [...table.headers],
        rows: table.rows.slice(offset, offset + limit).map((row) => [...row]),
      };
    },
    /** Check all source rows without modifying a preview or retaining a client-specific mapping. */
    async validate(id: string, input: unknown) {
      const table = ready(get(id));
      const { columns } = mappingSchema.parse(input);
      const result = validateTableMapping(table, columns);
      return { valid: result.valid, issues: result.issues };
    },
    /**
     * Revalidate the submitted mapping and publish exactly one independent inventory in one transaction.
     * @param id The prepared table token, retained as a receipt after publication.
     * @param input Destination metadata and the exact source-column interpretation to publish.
     * @returns The same inventory for equivalent concurrent or later retries; conflicting requests fail.
     */
    async confirm(id: string, input: unknown) {
      const entry = get(id);
      const data = confirmSchema.parse(input);
      const columns = normalizedColumns(data.columns);
      const metadata = {
        name: data.name,
        description: data.description,
        group_id: data.group_id ?? null,
      };
      const request = JSON.stringify({ ...metadata, columns });
      if (entry.request && entry.request !== request) throw busy();
      if (entry.inventoryId)
        return createInventoryService(db).get(entry.inventoryId);
      if (entry.pending) return entry.pending;
      const result = validateTableMapping(ready(entry), columns);
      if (!result.valid)
        throw new DomainError(
          "invalid_inventory_table_values",
          "Some table values do not match their mapped fields. Validate the mapping before confirming.",
        );
      const manifest: InventoryManifest = {
        format: "inventory-manager",
        version: 1,
        inventory: { name: metadata.name, description: metadata.description },
        fields: result.fields,
        items: result.items,
        attachments: [],
      };
      entry.request = request;
      const task = Promise.resolve()
        .then(() => {
          // Discard/reset must not authorize a publication after its session has been invalidated.
          if (sessions.get(id) !== entry) throw missing();
          return materializeInventory(db, manifest, metadata, new Map());
        })
        .then((inventory) => {
          entry.inventoryId = inventory.id;
          entry.expires = Date.now() + importSessionLifetime;
          delete entry.table;
          return inventory;
        })
        .catch((error: unknown) => {
          delete entry.request;
          throw error;
        })
        .finally(() => {
          delete entry.pending;
        });
      entry.pending = task;
      return task;
    },
    async discard(id: string) {
      const entry = get(id);
      if (entry.pending) throw busy();
      sessions.delete(id);
    },
    /** Release previews and receipts along with the application's existing import reset lifecycle. */
    reset() {
      sessions.clear();
    },
    /** Expire inactive previews and receipts while protecting pending publication. */
    cleanup(now = Date.now()) {
      for (const [id, entry] of sessions)
        if (!entry.pending && entry.expires <= now) sessions.delete(id);
    },
  };
}
