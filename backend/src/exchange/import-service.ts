import { createHash, randomUUID } from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  readdir,
  lstat,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { inventoryCreateSchema } from "../inventories/validation.js";
import { createInventoryService } from "../inventories/service.js";
import type { inventories } from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";
import type { createAttachmentService } from "../attachments/service.js";
import { DomainError } from "../errors.js";
import { validateArchive, invalidArchive } from "./archive-reader.js";
import { importSessionLifetime } from "./limits.js";
import { materializeInventory } from "./materialize.js";

type Validated = Awaited<ReturnType<typeof validateArchive>>;
type Inventory = typeof inventories.$inferSelect;
interface ImportSession extends Validated {
  workspace: string;
  expires: number;
  pending?: Promise<Inventory>;
  request?: string;
  inventoryId?: string;
}

/**
 * Stage checked inventories separately from database publication and managed file ownership.
 * @param db The destination database.
 * @param attachments The managed storage service, supplying reconciliation leases.
 * @param directory Explicit absolute managed file storage, never a development default.
 * @param tempDirectory Explicit scratch storage, separate from durable managed originals.
 * @returns Preview, atomic import, cancellation and reconciliation operations.
 */
export function createImportService(
  db: AppDatabase,
  attachments: ReturnType<typeof createAttachmentService>,
  directory: string,
  tempDirectory = join(directory, ".exchange"),
) {
  if (!isAbsolute(directory))
    throw new Error("Attachment directory must be absolute.");
  if (!isAbsolute(tempDirectory))
    throw new Error("Temporary directory must be absolute.");
  const root = tempDirectory;
  const sessions = new Map<string, ImportSession>();
  const active = new Set<string>();
  const missing = () =>
    new DomainError(
      "inventory_import_not_found",
      "The prepared import is unavailable or expired. Select the archive again.",
    );
  const busy = () =>
    new DomainError(
      "inventory_import_conflict",
      "This import is already being confirmed.",
    );
  const dispose = async (entry: { workspace: string }) => {
    try {
      await rm(entry.workspace, { recursive: true, force: true });
    } finally {
      active.delete(entry.workspace);
    }
  };
  const summary = (id: string, entry: ImportSession) => ({
    id,
    expires_at: new Date(entry.expires).toISOString(),
    inventory: { ...entry.manifest.inventory },
    field_count: entry.manifest.fields.length,
    item_count: entry.manifest.items.length,
    attachment_count: entry.manifest.attachments.length,
    attachment_bytes: entry.manifest.attachments.reduce(
      (sum, file) => sum + file.byte_size,
      0,
    ),
    status: entry.inventoryId
      ? ("completed" as const)
      : entry.pending
        ? ("importing" as const)
        : ("ready" as const),
    ...(entry.inventoryId ? { inventory_id: entry.inventoryId } : {}),
  });
  async function get(id: string) {
    const entry = sessions.get(id);
    if (!entry) throw missing();
    if (!entry.pending && entry.expires <= Date.now()) {
      sessions.delete(id);
      await dispose(entry);
      throw missing();
    }
    return entry;
  }

  /**
   * Verify and copy staged originals before publishing any active database records.
   * @param entry The privately validated staging session.
   * @param metadata Validated destination metadata.
   * @returns The atomically created inventory, with file copies independent of the source archive.
   */
  async function publish(
    entry: ImportSession,
    metadata: ReturnType<typeof inventoryCreateSchema.parse>,
  ) {
    const ids = new Map(
      entry.manifest.attachments.map((file) => [file.key, randomUUID()]),
    );
    const release = attachments.retainPendingFiles([...ids.values()]);
    const created: string[] = [];
    try {
      for (const file of entry.manifest.attachments) {
        const source = await open(
          entry.files.get(file.key)!,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const details = await source.stat();
          if (!details.isFile() || details.size !== file.byte_size)
            throw invalidArchive(
              "A staged attachment is unavailable or has changed. Select the archive again.",
            );
          const id = ids.get(file.key)!;
          const temporary = join(directory, `${id}.upload`);
          const destination = join(directory, `${id}.blob`);
          created.push(temporary, destination);
          const hash = createHash("sha256");
          let size = 0;
          const measured = new Transform({
            transform(chunk: Buffer, _encoding, done) {
              size += chunk.length;
              hash.update(chunk);
              done(
                size > file.byte_size
                  ? invalidArchive(
                      "A staged attachment exceeds its declared size.",
                    )
                  : null,
                chunk,
              );
            },
            flush(done) {
              done(
                size !== file.byte_size || hash.digest("hex") !== file.sha256
                  ? invalidArchive(
                      "A staged attachment failed checksum verification.",
                    )
                  : null,
              );
            },
          });
          await pipeline(
            source.createReadStream({ autoClose: false }),
            measured,
            createWriteStream(temporary, {
              flags: "wx",
              mode: 0o600,
              flush: true,
            }),
          );
          await rename(temporary, destination);
        } finally {
          await source.close();
        }
      }
      return materializeInventory(db, entry.manifest, metadata, ids);
    } catch (error) {
      // Failed physical removals remain unreferenced opaque files for ordinary reconciliation.
      await Promise.allSettled(created.map((path) => unlink(path)));
      throw error;
    } finally {
      release();
    }
  }

  return {
    /**
     * Copy and validate one ZIP without creating an inventory, then return its bounded preview summary.
     * @param content The original HTTP or local archive stream.
     * @param signal Cancellation of copying/validation.
     * @returns An opaque expiring token and summary; no filesystem paths are exposed.
     */
    async prepare(content: Readable, signal?: AbortSignal) {
      signal?.throwIfAborted();
      await mkdir(root, { recursive: true, mode: 0o700 });
      const workspace = await mkdtemp(join(root, "import-"));
      active.add(workspace);
      try {
        const path = join(workspace, "inventory.zip");
        await pipeline(
          content,
          createWriteStream(path, { flags: "wx", mode: 0o600, flush: true }),
          { ...(signal ? { signal } : {}) },
        );
        const validated = await validateArchive(
          path,
          workspace,
          signal ?? new AbortController().signal,
        );
        signal?.throwIfAborted();
        // The checked manifest and staged originals suffice for confirmation; don't retain a second archive copy.
        await unlink(path);
        signal?.throwIfAborted();
        const id = randomUUID();
        const entry: ImportSession = {
          ...validated,
          workspace,
          expires: Date.now() + importSessionLifetime,
        };
        sessions.set(id, entry);
        return summary(id, entry);
      } catch (error) {
        await dispose({ workspace });
        throw error;
      }
    },
    async read(id: string) {
      return summary(id, await get(id));
    },
    /**
     * Join identical duplicate confirmations and retain a successful receipt until expiry.
     * @param id The token whose validated contents are being imported.
     * @param input Optional overrides for name, description and destination group.
     * @returns The same created inventory for every identical successful confirmation.
     */
    async confirm(id: string, input: unknown) {
      const entry = await get(id);
      if (sessions.get(id) !== entry) throw missing();
      const overrides = inventoryCreateSchema
        .partial()
        .extend({
          // An omitted override must preserve the archive description, not apply create-time defaults.
          description: inventoryCreateSchema.shape.description
            .unwrap()
            .optional(),
        })
        .strict()
        .parse(input);
      const metadata = inventoryCreateSchema.parse({
        ...entry.manifest.inventory,
        ...overrides,
      });
      const request = JSON.stringify({
        name: metadata.name,
        description: metadata.description,
        group_id: metadata.group_id ?? null,
      });
      if (entry.request && entry.request !== request) throw busy();
      if (entry.inventoryId)
        return createInventoryService(db).get(entry.inventoryId);
      if (entry.pending) return entry.pending;
      entry.request = request;
      const task = publish(entry, metadata)
        .then(async (inventory) => {
          // Record success BEFORE cleanup: a lost response or failed unlink must never duplicate the inventory.
          entry.inventoryId = inventory.id;
          entry.expires = Date.now() + importSessionLifetime;
          await dispose(entry).catch(() => {});
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
      const entry = await get(id);
      if (sessions.get(id) !== entry) throw missing();
      if (entry.pending) throw busy();
      sessions.delete(id);
      await dispose(entry);
    },
    /**
     * Expire previews/receipts, retry staging cleanup and remove stale interrupted-process workspaces.
     * @param now The cleanup time; tests use deterministic boundaries.
     */
    async cleanup(now = Date.now()) {
      for (const [id, entry] of sessions) {
        if (entry.pending) continue;
        if (entry.expires <= now) {
          sessions.delete(id);
          await dispose(entry);
        } else if (entry.inventoryId) await dispose(entry);
      }
      let names: string[];
      try {
        names = await readdir(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const name of names) {
        if (!/^import-[a-zA-Z0-9]{6}$/.test(name)) continue;
        const path = join(root, name);
        if (active.has(path)) continue;
        try {
          const details = await lstat(path);
          if (
            details.isDirectory() &&
            details.mtimeMs < now - 24 * 60 * 60 * 1000
          )
            await rm(path, { recursive: true, force: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    },
  };
}
