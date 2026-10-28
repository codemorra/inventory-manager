import { randomUUID, createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import type { AppDatabase } from "../db/types.js";
import type { createAttachmentService } from "../attachments/service.js";
import { readExportSnapshot } from "./snapshot.js";
import { createInventoryService } from "../inventories/service.js";
import { maxArchiveEntries, maxManifestBytes } from "./limits.js";
import { DomainError } from "../errors.js";

interface ExportArtifact {
  path: string;
  filename: string;
  byteSize: number;
  dispose: () => Promise<void>;
}
const exportLifetime = 15 * 60 * 1000;

/**
 * Derive a portable download filename without treating inventory names as filesystem paths.
 * @param name The original display name.
 * @returns A bounded, nonempty ZIP filename without separators, controls, or Windows metacharacters.
 */
export function archiveFilename(name: string) {
  const base = Array.from(name)
    .map((letter) =>
      /[<>:"/\\|?*]/u.test(letter) ||
      letter.codePointAt(0)! < 32 ||
      letter.codePointAt(0) === 127
        ? "_"
        : letter,
    )
    .slice(0, 100)
    .join("")
    .replace(/^[. ]+|[. ]+$/g, "");
  const safe = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)
    ? `_${base}`
    : base;
  return `${safe || "inventory"}.zip`;
}

/**
 * Build completed, verified ZIPs on disk; original files and archives are never buffered in full.
 * @param db The inventory database.
 * @param attachments The existing managed-file reader, preserving its lifecycle and storage checks.
 * @param directory Explicit absolute private scratch storage, separate from durable files.
 * @returns Export and orphan reconciliation operations.
 */
export function createExportService(
  db: AppDatabase,
  attachments: ReturnType<typeof createAttachmentService>,
  directory: string,
) {
  if (!isAbsolute(directory))
    throw new Error("Temporary directory must be absolute.");
  const active = new Set<string>();
  const prepared = new Map<
    string,
    { inventoryId: string; artifact: ExportArtifact; expires: number }
  >();
  function missing(): never {
    throw new DomainError(
      "inventory_export_not_found",
      "The prepared export is unavailable or expired. Please export the inventory again.",
    );
  }

  return {
    /**
     * Produce a complete immutable artifact before an HTTP download starts.
     * @param inventoryId The saved inventory to export.
     * @param signal Cancellation from a disconnected client.
     * @returns The completed archive path/name and an idempotent disposal operation.
     */
    async create(inventoryId: string, signal?: AbortSignal) {
      signal?.throwIfAborted();
      const snapshot = readExportSnapshot(db, inventoryId);
      const manifestJson = `${JSON.stringify(snapshot.manifest, null, 2)}\n`;
      if (
        Buffer.byteLength(manifestJson) > maxManifestBytes ||
        snapshot.sources.length + 1 > maxArchiveEntries
      )
        throw new DomainError(
          "inventory_export_unavailable",
          "Inventory metadata exceeds the supported archive processing bounds.",
        );
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const workspace = await mkdtemp(join(directory, "export-"));
      active.add(workspace);
      const path = join(workspace, "inventory.zip");
      const zip = new ZipFile();
      const output = zip.outputStream as Readable;
      const streams = new Set<Readable>();
      const jobs: Promise<void>[] = [];
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      const dispose = async () => {
        try {
          await rm(workspace, { recursive: true, force: true });
        } finally {
          active.delete(workspace);
        }
      };
      zip.on("error", (error: Error) => output.destroy(error));
      const completion = pipeline(
        output,
        createWriteStream(path, { flags: "wx", mode: 0o600, flush: true }),
        { signal: controller.signal },
      );
      // Observe failures immediately, including while lazy managed reads are still opening.
      void completion.catch(() => {});
      try {
        zip.addBuffer(Buffer.from(manifestJson), "inventory.json", {
          mode: 0o100600,
        });
        for (const [index, file] of snapshot.sources.entries()) {
          zip.addReadStreamLazy(
            `attachments/${snapshot.manifest.attachments[index]!.key}`,
            { size: file.byteSize, mode: 0o100600 },
            (callback) => {
              const job = (async () => {
                controller.signal.throwIfAborted();
                const source = await attachments.download(
                  inventoryId,
                  file.fieldId,
                  file.id,
                );
                streams.add(source.stream);
                const hash = createHash("sha256");
                let size = 0;
                const measured = new Transform({
                  transform(chunk: Buffer, _encoding, done) {
                    size += chunk.length;
                    hash.update(chunk);
                    done(null, chunk);
                  },
                  flush(done) {
                    done(
                      size === file.byteSize &&
                        hash.digest("hex") === file.sha256
                        ? null
                        : new DomainError(
                            "inventory_export_unavailable",
                            "An attachment failed its saved size or checksum verification.",
                          ),
                    );
                  },
                });
                streams.add(measured);
                callback(null, measured);
                await pipeline(source.stream, measured, {
                  signal: controller.signal,
                });
                streams.delete(source.stream);
                streams.delete(measured);
              })().catch((error: unknown) => {
                output.destroy(error as Error);
              });
              jobs.push(job);
            },
          );
        }
        zip.end();
        await completion;
        await Promise.all(jobs);
        signal?.throwIfAborted();
        if (
          readExportSnapshot(db, inventoryId).fingerprint !==
          snapshot.fingerprint
        )
          throw new DomainError(
            "inventory_export_conflict",
            "The inventory changed during export. Please export it again.",
          );
        return {
          path,
          filename: archiveFilename(snapshot.manifest.inventory.name),
          byteSize: (await stat(path)).size,
          dispose,
        };
      } catch (error) {
        controller.abort();
        for (const stream of streams) stream.destroy();
        await Promise.allSettled([completion, ...jobs]);
        // A lazy read may have finished opening after cancellation.
        for (const stream of streams) stream.destroy();
        await dispose();
        throw error;
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
    /**
     * Prepare a short-lived download without exposing its managed scratch path.
     * @param inventoryId The saved inventory to export.
     * @param signal Cancellation of archive preparation.
     * @returns An opaque single-use download identity and display metadata.
     */
    async prepare(inventoryId: string, signal?: AbortSignal) {
      const artifact = await this.create(inventoryId, signal);
      const id = randomUUID();
      const expires = Date.now() + exportLifetime;
      prepared.set(id, { inventoryId, artifact, expires });
      return {
        id,
        filename: artifact.filename,
        byte_size: artifact.byteSize,
        expires_at: new Date(expires).toISOString(),
      };
    },
    /**
     * Claim a completed artifact for exactly one download or discard operation.
     * @param inventoryId The inventory owning the prepared export.
     * @param id The opaque export identity.
     * @returns An artifact whose consumer owns disposal, protected from maintenance until disposed.
     */
    async take(inventoryId: string, id: string): Promise<ExportArtifact> {
      const entry = prepared.get(id);
      if (!entry || entry.inventoryId !== inventoryId) return missing();
      prepared.delete(id);
      if (entry.expires <= Date.now()) {
        await entry.artifact.dispose();
        return missing();
      }
      // A deleted source must not leave a prepared copy available for later download.
      try {
        createInventoryService(db).get(inventoryId);
      } catch (error) {
        await entry.artifact.dispose();
        throw error;
      }
      return entry.artifact;
    },
    /**
     * Invalidate prepared archives after replacing the application's data.
     * @returns Completion after all retained export bodies have been disposed.
     * @throws {Error} When temporary storage cleanup fails; tokens remain invalidated.
     */
    async reset() {
      const entries = [...prepared.values()];
      prepared.clear();
      await Promise.all(entries.map((entry) => entry.artifact.dispose()));
    },
    /**
     * Remove only stale export workspaces, including leftovers from an interrupted process.
     * @param now The cleanup time; tests use a deterministic expiry boundary.
     */
    async cleanup(now = Date.now()) {
      for (const [id, entry] of prepared) {
        if (entry.expires <= now) {
          prepared.delete(id);
          await entry.artifact.dispose();
        }
      }
      let names;
      try {
        names = await readdir(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      for (const name of names) {
        if (!/^export-[a-zA-Z0-9]{6}$/.test(name)) continue;
        const path = join(directory, name);
        if (active.has(path)) continue;
        try {
          const entry = await lstat(path);
          if (entry.isDirectory() && entry.mtimeMs < now - 24 * 60 * 60 * 1000)
            await rm(path, { recursive: true, force: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    },
  };
}
