import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { openPromise, type Entry, type ZipFile } from "yauzl";
import type { AppConfig } from "../config.js";
import { DomainError } from "../errors.js";
import { readEntry } from "../exchange/archive-reader.js";
import { maxArchiveEntries, maxManifestBytes } from "../exchange/limits.js";
import {
  backupManifestSchema,
  invalidBackup,
  type BackupManifest,
} from "./manifest.js";

const backupFilename =
  /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.zip$/;
type Metadata = Pick<BackupManifest, "id" | "created_at" | "kind">;
export interface StoredBackup {
  filename: string;
  byte_size: number;
  metadata: Metadata | null;
}

/**
 * Create the stable error used for unavailable or invalid download selections.
 * @returns A backup_not_found domain error for the caller to throw.
 */
function missingBackup() {
  return new DomainError(
    "backup_not_found",
    "The backup is no longer available. Reload the backup list.",
  );
}

/**
 * Read bounded display metadata without decompressing the database or attachments.
 * @param path A regular archive file selected from managed backup storage.
 * @returns The manifest identity, creation time and backup kind.
 * @throws {Error} When archive metadata cannot be read or validated.
 */
async function readMetadata(path: string): Promise<Metadata> {
  let zip: ZipFile | undefined;
  const controller = new AbortController();
  try {
    zip = await openPromise(path, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    zip.on("error", () => controller.abort());
    if (zip.entryCount > maxArchiveEntries)
      throw invalidBackup("Too many backup entries.");
    let manifest: Entry | undefined;
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName !== "backup.json") continue;
      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        manifest ||
        entry.uncompressedSize > maxManifestBytes ||
        entry.isEncrypted() ||
        ![0, 8].includes(entry.compressionMethod) ||
        (type !== 0 && type !== 0o100000)
      )
        throw invalidBackup("Invalid backup metadata entry.");
      manifest = entry;
    }
    if (!manifest) throw invalidBackup("Missing backup metadata.");
    const chunks: Buffer[] = [];
    await readEntry(
      zip,
      manifest,
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
    const parsed = backupManifestSchema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      ),
    );
    return { id: parsed.id, created_at: parsed.created_at, kind: parsed.kind };
  } finally {
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
 * Compose backup listing and streaming against the runtime's current storage paths.
 * @param config The live configuration updated after storage relocation.
 * @returns Operations for listing and downloading durable backup artifacts.
 */
export function createBackupCatalog(config: AppConfig) {
  return {
    /**
     * List regular application-named archives, retaining entries with unreadable metadata.
     * @returns Backup filenames, compressed sizes and available metadata, newest filename first.
     * @throws {Error} When the backup directory cannot be enumerated or inspected.
     */
    async list(): Promise<StoredBackup[]> {
      const directory = config.backupsDirectory;
      const backups: StoredBackup[] = [];
      for (const filename of (await readdir(directory)).sort().reverse()) {
        if (!backupFilename.test(filename)) continue;
        const path = join(directory, filename);
        let details;
        try {
          details = await lstat(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        if (!details.isFile()) continue;
        backups.push({
          filename,
          byte_size: details.size,
          metadata: await readMetadata(path).catch(() => null),
        });
      }
      return backups;
    },
    /**
     * Open a regular backup file without following links or accepting filesystem paths.
     * @param filename An application-generated basename returned by the backup list.
     * @returns A readable stream and exact download size; its consumer owns stream disposal.
     * @throws {DomainError} When the name is invalid or its regular file is unavailable.
     * @throws {Error} When storage access fails for another reason.
     */
    async download(filename: string) {
      if (!backupFilename.test(filename)) throw missingBackup();
      let file;
      try {
        const path = join(config.backupsDirectory, filename);
        if (!(await lstat(path)).isFile()) throw missingBackup();
        file = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        const details = await file.stat();
        if (!details.isFile()) throw missingBackup();
        return {
          filename,
          byte_size: details.size,
          stream: file.createReadStream(),
        };
      } catch (error) {
        await file?.close();
        if (
          /^(ENOENT|ELOOP|EISDIR)$/.test(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw missingBackup();
        throw error;
      }
    },
  };
}
