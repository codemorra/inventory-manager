import { attachmentMetadataSchema } from "./validation.js";
import { randomUUID, createHash } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, stat, unlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq, isNull, isNotNull, lt } from "drizzle-orm";
import { inventoryAttachments } from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";
import { createInventoryService } from "../inventories/service.js";
import { createFieldService } from "../fields/service.js";
import { DomainError } from "../errors.js";
import { tombstoneAttachments } from "./metadata.js";
import { isPreviewRaster, queuePreview, renderPreview } from "./preview.js";

import { stagedAttachmentLifetime } from "./constants.js";
export { stagedAttachmentLifetime } from "./constants.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Storage must be explicitly configured; test service composition never falls back to development data.
export interface AttachmentStorageOptions {
  directory: string;
}

/**
 * Manage streamed file copies and retryable post-commit cleanup independently of HTTP.
 * @param db The database holding attachment ownership and lifecycle metadata.
 * @param options The absolute managed directory.
 * @returns Staging, lookup, download, cancellation, and reconciliation operations.
 */
export function createAttachmentService(
  db: AppDatabase,
  options: AttachmentStorageOptions,
) {
  if (!isAbsolute(options.directory))
    throw new Error("Attachment directory must be absolute.");
  const inflight = new Set<string>();
  let cleaning: Promise<void> | undefined;
  const path = (id: string, extension = "blob") => {
    if (!uuid.test(id)) throw new Error("Invalid managed file identifier.");
    return join(options.directory, `${id}.${extension}`);
  };

  /**
   * Verify that an active inventory field accepts file attachments.
   * @param connection The current transaction or read connection.
   * @param inventoryId The inventory owning the upload.
   * @param fieldId The field for the future cell.
   */
  function requireField(
    connection: AppDatabase,
    inventoryId: string,
    fieldId: string,
  ) {
    const inventories = createInventoryService(connection);
    const field = createFieldService(connection, inventories).get(
      inventoryId,
      fieldId,
    );
    if (field.fieldType !== "attachment")
      throw new DomainError(
        "invalid_inventory_field_configuration",
        "This field does not accept attachments.",
      );
  }

  /**
   * Resolve only active files within their original inventory/field ownership.
   * @param inventoryId The parent inventory.
   * @param fieldId The file's field.
   * @param id The opaque attachment identifier.
   * @returns Active attachment metadata, including staged files.
   */
  function get(inventoryId: string, fieldId: string, id: string) {
    requireField(db, inventoryId, fieldId);
    const file = db
      .select()
      .from(inventoryAttachments)
      .where(
        and(
          eq(inventoryAttachments.id, id),
          eq(inventoryAttachments.inventoryId, inventoryId),
          eq(inventoryAttachments.fieldId, fieldId),
          isNull(inventoryAttachments.deletedAt),
        ),
      )
      .get();
    if (!file)
      throw new DomainError(
        "inventory_attachment_not_found",
        "Attachment not found.",
      );
    return file;
  }

  return {
    get,
    /**
     * Stream an upload into an opaque managed file; publish metadata only after all bytes are durable.
     * @param inventoryId The active parent inventory.
     * @param fieldId The destination attachment field.
     * @param input Original filename and declared media type.
     * @param content The binary upload stream.
     * @returns A staged attachment that can be claimed by a later atomic item save.
     */
    async upload(
      inventoryId: string,
      fieldId: string,
      input: unknown,
      content: Readable,
    ) {
      const metadata = attachmentMetadataSchema.parse(input);
      requireField(db, inventoryId, fieldId);
      await mkdir(options.directory, { recursive: true });
      const id = randomUUID();
      inflight.add(id);
      let bytes = 0;
      const hash = createHash("sha256");
      try {
        // Count and hash chunks while streaming; file size is not capped by the application.
        const measure = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length;
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        await pipeline(
          content,
          measure,
          createWriteStream(path(id, "upload"), {
            flags: "wx",
            mode: 0o600,
            flush: true,
          }),
        );
        await rename(path(id, "upload"), path(id));
        // Recheck lifecycle after asynchronous streaming; a field may have been deleted in the meantime.
        return db.transaction((transaction) => {
          requireField(transaction, inventoryId, fieldId);
          return transaction
            .insert(inventoryAttachments)
            .values({
              id,
              inventoryId,
              fieldId,
              filename: metadata.filename,
              mediaType: metadata.media_type,
              byteSize: bytes,
              sha256: hash.digest("hex"),
            })
            .returning()
            .get();
        });
      } catch (error) {
        // If unlink itself fails, the reconciliation sweep retries these unreferenced opaque files later.
        await Promise.allSettled([
          unlink(path(id, "upload")),
          unlink(path(id)),
        ]);
        throw error;
      } finally {
        inflight.delete(id);
      }
    },

    /**
     * Open a regular managed file without following symlinks or resolving client-supplied paths.
     * @param inventoryId The parent inventory.
     * @param fieldId The file's field.
     * @param id The opaque file identifier.
     * @returns Verified metadata and a binary stream owned by the caller.
     */
    async download(inventoryId: string, fieldId: string, id: string) {
      const metadata = get(inventoryId, fieldId, id);
      let handle;
      try {
        handle = await open(
          path(id),
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        const details = await handle.stat();
        if (!details.isFile() || details.size !== metadata.byteSize)
          throw new Error("Managed attachment content is unavailable.");
        // A deletion during the asynchronous open must not expose content from a cleared record.
        get(inventoryId, fieldId, id);
        return { metadata, stream: handle.createReadStream() };
      } catch (error) {
        await handle?.close();
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          throw new DomainError(
            "inventory_attachment_not_found",
            "Attachment content not found.",
          );
        throw error;
      }
    },

    /**
     * Generate a transient raster thumbnail while preserving download-only original endpoints.
     * @param inventoryId The file's parent inventory.
     * @param fieldId The file's attachment field.
     * @param id The opaque managed file identity.
     * @returns Small WebP bytes; missing/deleted/unsupported files never expose their original bytes inline.
     */
    preview(inventoryId: string, fieldId: string, id: string) {
      return queuePreview(async () => {
        const metadata = get(inventoryId, fieldId, id);
        let handle;
        try {
          handle = await open(
            path(id),
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          const details = await handle.stat();
          if (!details.isFile() || details.size !== metadata.byteSize)
            throw new DomainError(
              "attachment_preview_unavailable",
              "Attachment content is unavailable.",
            );
          const header = Buffer.alloc(12);
          const read = await handle.read(header, 0, header.length, 0);
          if (!isPreviewRaster(header.subarray(0, read.bytesRead)))
            throw new DomainError(
              "attachment_preview_unavailable",
              "This file does not support image previews.",
            );
          const buffer = await renderPreview(path(id));
          // Deletion during native processing must take effect before any thumbnail is returned.
          get(inventoryId, fieldId, id);
          return buffer;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            throw new DomainError(
              "inventory_attachment_not_found",
              "Attachment content not found.",
            );
          throw error;
        } finally {
          await handle?.close();
        }
      });
    },

    /**
     * Cancel a staged upload only; permanent files are removed through revision-checked item saves.
     * @param inventoryId The parent inventory.
     * @param fieldId The staged file's field.
     * @param id The upload being discarded.
     */
    discard(inventoryId: string, fieldId: string, id: string) {
      db.transaction((transaction) => {
        const file = get(inventoryId, fieldId, id);
        if (file.itemId !== null)
          throw new DomainError(
            "attachment_already_attached",
            "Saved attachments must be removed by editing their item.",
          );
        tombstoneAttachments(transaction, eq(inventoryAttachments.id, id));
      });
    },

    /**
     * Retry deleted files, expire abandoned stages, and optionally sweep old interrupted/orphan uploads.
     * @param sweep Whether to reconcile unreferenced storage files as well as committed tombstones.
     * @param now The cleanup time; explicit values support deterministic expiry tests.
     * @returns Completion after all eligible files are processed; failures leave retryable tombstones.
     */
    cleanup(sweep = true, now = Date.now()): Promise<void> {
      if (cleaning) return cleaning;
      cleaning = (async () => {
        const cutoff = new Date(now - stagedAttachmentLifetime).toISOString();
        db.transaction((transaction) =>
          tombstoneAttachments(
            transaction,
            and(
              isNull(inventoryAttachments.itemId),
              lt(inventoryAttachments.createdAt, cutoff),
            ),
          ),
        );
        const errors: unknown[] = [];
        for (const file of db
          .select()
          .from(inventoryAttachments)
          .where(
            and(
              eq(inventoryAttachments.storagePurged, false),
              isNotNull(inventoryAttachments.deletedAt),
            ),
          )
          .all()) {
          try {
            try {
              await unlink(path(file.id));
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
            db.update(inventoryAttachments)
              .set({ storagePurged: true, updatedAt: file.updatedAt })
              .where(eq(inventoryAttachments.id, file.id))
              .run();
          } catch (error) {
            errors.push(error);
          }
        }
        if (sweep) {
          let entries: string[];
          try {
            entries = await readdir(options.directory);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            entries = [];
          }
          for (const name of entries) {
            const match = /^([0-9a-f-]{36})\.(blob|upload)$/.exec(name);
            if (!match || !uuid.test(match[1]!) || inflight.has(match[1]!))
              continue;
            const record = db
              .select()
              .from(inventoryAttachments)
              .where(eq(inventoryAttachments.id, match[1]!))
              .get();
            if (
              record ||
              (await stat(join(options.directory, name))).mtimeMs >=
                now - stagedAttachmentLifetime
            )
              continue;
            try {
              await unlink(join(options.directory, name));
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                errors.push(error);
            }
          }
        }
        if (errors.length)
          throw new AggregateError(
            errors,
            "Attachment cleanup failed; retry is required.",
          );
      })().finally(() => {
        cleaning = undefined;
      });
      return cleaning;
    },
  };
}
