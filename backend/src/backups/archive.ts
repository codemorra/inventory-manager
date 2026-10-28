import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";
import { openPromise, type Entry, type ZipFile as ZipReader } from "yauzl";
import { ZipFile } from "yazl";
import { readEntry } from "../exchange/archive-reader.js";
import { maxArchiveEntries, maxManifestBytes } from "../exchange/limits.js";
import {
  backupManifestSchema,
  invalidBackup,
  type BackupFile,
  type BackupManifest,
} from "./manifest.js";

/**
 * Hash a regular source file with bounded memory, rejecting links and special files.
 * @param path The local source file to read.
 * @param archivePath The file's entry path in the backup manifest.
 * @returns The archive path, actual byte count and SHA-256 digest.
 * @throws {DomainError} When the source is not a regular file.
 * @throws {Error} When the source cannot be inspected or read.
 */
export async function describeFile(
  path: string,
  archivePath: string,
): Promise<BackupFile> {
  if (!(await lstat(path)).isFile())
    throw invalidBackup("Backup sources must be regular files.");
  const hash = createHash("sha256");
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    hash.update(bytes);
    byteSize += bytes.length;
  }
  return { path: archivePath, byte_size: byteSize, sha256: hash.digest("hex") };
}

/**
 * Read required managed files from a checked snapshot, including unclaimed uploads and excluding deleted files.
 * @param path The existing SQLite snapshot to open read-only.
 * @returns Active attachment identities, saved byte counts and available SHA-256 digests, ordered by identity.
 * @throws {DomainError} When SQLite integrity or foreign-key checks fail.
 * @throws {Error} When the snapshot cannot be opened or its attachment records cannot be queried.
 */
export function databaseFiles(path: string) {
  const database = new Database(path, { readonly: true, fileMustExist: true });
  try {
    if (
      database.pragma("integrity_check", { simple: true }) !== "ok" ||
      (database.pragma("foreign_key_check") as unknown[]).length
    )
      throw invalidBackup("The backup database failed its integrity checks.");
    return database
      .prepare(
        "SELECT id, byte_size, sha256 FROM inventory_attachments WHERE deleted_at IS NULL ORDER BY id",
      )
      .all() as {
      id: string;
      byte_size: number;
      sha256: string | null;
    }[];
  } finally {
    database.close();
  }
}

/**
 * Write a private ZIP; callers publish it only after validating the completed artifact.
 * @param path The destination ZIP path, which must not already exist.
 * @param manifest Validated metadata describing every source file.
 * @param sources A map from each manifest entry path to its local source file.
 * @returns Completion once the ZIP has been written, flushed and closed.
 * @throws {DomainError} When metadata exceeds the archive processing bounds.
 * @throws {Error} When a source cannot be read or the ZIP cannot be written.
 */
export async function writeBackup(
  path: string,
  manifest: BackupManifest,
  sources: Map<string, string>,
) {
  const json = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  if (
    json.length > maxManifestBytes ||
    manifest.files.length + 1 > maxArchiveEntries
  )
    throw invalidBackup(
      "Backup metadata exceeds the supported processing bounds.",
    );
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  const controller = new AbortController();
  zip.on("error", (error: Error) => output.destroy(error));
  const completion = pipeline(
    output,
    createWriteStream(path, { flags: "wx", mode: 0o600, flush: true }),
  );
  void completion.catch(() => {});
  try {
    zip.addBuffer(json, "backup.json", { mode: 0o100600 });
    for (const entry of manifest.files)
      zip.addReadStreamLazy(
        entry.path,
        { size: entry.byte_size, mode: 0o100600 },
        (callback) => {
          callback(
            null,
            createReadStream(sources.get(entry.path)!, {
              signal: controller.signal,
            }),
          );
        },
      );
    zip.end();
    await completion;
  } catch (error) {
    controller.abort();
    output.destroy();
    await completion.catch(() => {});
    throw error;
  }
}

/**
 * Validate archive entries and database/file references before a new backup becomes visible.
 * @param path The completed ZIP archive to verify.
 * @param workspace An existing private directory with room for a new verified.db snapshot.
 * @param extractAttachments Whether to retain verified attachment bodies for restoration.
 * @param signal Optional cancellation while validating an unconfirmed restore selection.
 * @returns The validated backup manifest after all file and database checks succeed.
 * @throws {DomainError} When the archive is invalid, damaged or unsupported.
 * @throws {Error} When a system storage failure prevents verification.
 */
export async function verifyBackup(
  path: string,
  workspace: string,
  extractAttachments = false,
  signal?: AbortSignal,
): Promise<BackupManifest> {
  let zip: ZipReader | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    zip = await openPromise(path, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    zip.on("error", () => controller.abort());
    if (zip.entryCount > maxArchiveEntries)
      throw invalidBackup("Too many backup entries.");
    const entries = new Map<string, Entry>();
    for await (const entry of zip.eachEntry()) {
      controller.signal.throwIfAborted();
      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        !/^(backup\.json|inventory\.db|attachments\/[0-9a-f-]{36}\.blob)$/.test(
          entry.fileName,
        ) ||
        entries.has(entry.fileName) ||
        entry.isEncrypted() ||
        ![0, 8].includes(entry.compressionMethod) ||
        (type !== 0 && type !== 0o100000) ||
        (entry.externalFileAttributes & 0x10) !== 0 ||
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize < 0 ||
        !Number.isSafeInteger(entry.compressedSize) ||
        entry.compressedSize < 0 ||
        !Number.isSafeInteger(entry.relativeOffsetOfLocalHeader) ||
        entry.relativeOffsetOfLocalHeader < 0
      )
        throw invalidBackup(
          "Unexpected, duplicate or unsupported backup entry.",
        );
      entries.set(entry.fileName, entry);
    }
    /**
     * Read bounded JSON metadata after verifying the entry's byte count and CRC.
     * @param name The exact ZIP entry name selected from the checked directory.
     * @param maximum The maximum permitted uncompressed byte count.
     * @returns Parsed JSON requiring subsequent schema validation.
     * @throws {DomainError} When the entry is missing, oversized or fails verification.
     * @throws {Error} When reading, UTF-8 decoding or JSON parsing fails.
     */
    async function readJson(name: string, maximum: number) {
      const entry = entries.get(name);
      if (!entry || entry.uncompressedSize > maximum)
        throw invalidBackup("Missing or oversized backup metadata.");
      const chunks: Buffer[] = [];
      await readEntry(
        zip!,
        entry,
        () =>
          new Writable({
            write(chunk: Buffer, _encoding, done) {
              chunks.push(chunk);
              done();
            },
          }),
        controller.signal,
        undefined,
        invalidBackup,
      );
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      ) as unknown;
    }
    const manifest = backupManifestSchema.parse(
      await readJson("backup.json", maxManifestBytes),
    );
    if (
      entries.size !== manifest.files.length + 1 ||
      manifest.files.some((entry) => !entries.has(entry.path))
    )
      throw invalidBackup("Backup contents do not match the manifest.");
    const databasePath = join(workspace, "verified.db");
    if (extractAttachments)
      await mkdir(join(workspace, "attachments"), { mode: 0o700 });
    for (const file of manifest.files) {
      const entry = entries.get(file.path)!;
      if (entry.uncompressedSize !== file.byte_size)
        throw invalidBackup("Backup entry size mismatch.");
      await readEntry(
        zip,
        entry,
        () =>
          file.path === "inventory.db" || extractAttachments
            ? createWriteStream(
                file.path === "inventory.db"
                  ? databasePath
                  : join(
                      workspace,
                      "attachments",
                      file.path.slice("attachments/".length),
                    ),
                {
                  flags: "wx",
                  mode: 0o600,
                  flush: true,
                },
              )
            : new Writable({
                write(_chunk, _encoding, done) {
                  done();
                },
              }),
        controller.signal,
        file,
        invalidBackup,
      );
    }
    const attachments = databaseFiles(databasePath);
    const files = new Map(manifest.files.map((file) => [file.path, file]));
    if (attachments.length + 1 !== files.size)
      throw invalidBackup("Backup attachments do not match the database.");
    for (const attachment of attachments) {
      const file = files.get(`attachments/${attachment.id}.blob`);
      if (
        !file ||
        file.byte_size !== attachment.byte_size ||
        (attachment.sha256 !== null && file.sha256 !== attachment.sha256)
      )
        throw invalidBackup(
          "A backup attachment does not match its database record.",
        );
    }
    controller.signal.throwIfAborted();
    return manifest;
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    if (
      error instanceof Error &&
      "code" in error &&
      /^(EACCES|EPERM|ENOSPC|EIO|EMFILE|ENFILE|EROFS)$/.test(String(error.code))
    )
      throw error;
    throw invalidBackup(
      "The backup archive is invalid, damaged or unsupported.",
    );
  } finally {
    signal?.removeEventListener("abort", abort);
    if (zip) {
      const closed = new Promise<void>((resolve) =>
        zip!.once("close", resolve),
      );
      zip.close();
      await closed;
    }
  }
}

/**
 * Sync SQLite's completed snapshot before it is read into an archive.
 * @param path The existing snapshot file to flush to storage.
 * @returns Completion once the snapshot has been flushed and its handle closed.
 * @throws {Error} When the snapshot cannot be opened, flushed or closed.
 */
export async function syncSnapshot(path: string) {
  const file = await open(path, "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
