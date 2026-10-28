import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32 } from "node:zlib";
import { openPromise, type Entry, type ZipFile } from "yauzl";
import { inventoryManifestSchema, type InventoryManifest } from "./manifest.js";
import { maxArchiveEntries, maxManifestBytes } from "./limits.js";
import { DomainError } from "../errors.js";

/**
 * Return a user-facing format error without exposing local scratch paths or decoder internals.
 * @param message A description of the failed archive check.
 * @returns The stable import validation error.
 */
export function invalidArchive(message: string) {
  return new DomainError("invalid_inventory_archive", message);
}

/**
 * Read an entry with real byte-count, CRC and optional SHA-256 verification while streaming.
 * @param zip The validated lazy archive reader.
 * @param entry The exact central directory entry.
 * @param target The private file writer or bounded manifest collector.
 * @param signal Cancellation from the caller.
 * @param expected Optional attachment metadata verified against actual bytes.
 * @param invalid Format-specific error factory, shared by inventory exchange and full backups.
 */
export async function readEntry(
  zip: ZipFile,
  entry: Entry,
  target: () => Writable,
  signal: AbortSignal,
  expected?: { byte_size: number; sha256: string },
  invalid: (message: string) => Error = invalidArchive,
) {
  signal.throwIfAborted();
  const source = await zip.openReadStreamPromise(entry);
  let size = 0;
  let crc = 0;
  const hash = createHash("sha256");
  const maximum = expected?.byte_size ?? maxManifestBytes;
  const measured = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > maximum) {
        done(
          invalid(
            "An archive entry exceeds its declared size or the manifest processing bound.",
          ),
        );
        return;
      }
      crc = crc32(chunk, crc);
      hash.update(chunk);
      done(null, chunk);
    },
    flush(done) {
      done(
        size !== entry.uncompressedSize ||
          crc !== entry.crc32 ||
          (expected &&
            (size !== expected.byte_size ||
              hash.digest("hex") !== expected.sha256))
          ? invalid(
              "An archive entry failed its size, CRC or SHA-256 verification.",
            )
          : null,
      );
    },
  });
  await pipeline(source, measured, target(), { signal });
}

/**
 * Validate the ZIP layout and manifest, then stream only expected files into generated staging names.
 * @param path A privately copied ZIP, never a user-supplied filesystem path.
 * @param workspace The private staging directory.
 * @param signal Cancellation of the entire validation operation.
 * @returns The validated manifest and generated source paths for confirmed import.
 */
export async function validateArchive(
  path: string,
  workspace: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  let zip: ZipFile | undefined;
  let decodingError: unknown;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try {
    zip = await openPromise(path, {
      autoClose: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    zip.on("error", (error: unknown) => {
      decodingError = error;
      controller.abort();
    });
    if (signal.aborted) abort();
    if (
      !Number.isSafeInteger(zip.entryCount) ||
      zip.entryCount > maxArchiveEntries
    )
      throw invalidArchive(
        "The archive exceeds the entry-count processing bound.",
      );
    const entries = new Map<string, Entry>();
    for await (const entry of zip.eachEntry()) {
      controller.signal.throwIfAborted();
      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      const directory = entry.fileName === "attachments/";
      if (entries.has(entry.fileName))
        throw invalidArchive("Duplicate archive entry names are not allowed.");
      if (!(
        entry.fileName === "inventory.json" ||
        directory ||
        /^attachments\/[a-zA-Z0-9_-]{1,128}$/.test(entry.fileName)
      ))
        throw invalidArchive(
          "The archive contains an unexpected or unsafe entry path.",
        );
      if (
        entry.isEncrypted() ||
        ![0, 8].includes(entry.compressionMethod) ||
        (type !== 0 && type !== (directory ? 0o040000 : 0o100000)) ||
        (!directory && (entry.externalFileAttributes & 0x10) !== 0) ||
        !Number.isSafeInteger(entry.compressedSize) ||
        entry.compressedSize < 0 ||
        !Number.isSafeInteger(entry.relativeOffsetOfLocalHeader) ||
        entry.relativeOffsetOfLocalHeader < 0 ||
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize < 0 ||
        (directory && entry.uncompressedSize !== 0)
      )
        throw invalidArchive(
          "Only unencrypted regular files using ZIP Store or Deflate are supported.",
        );
      entries.set(entry.fileName, entry);
    }
    const manifestEntry = entries.get("inventory.json");
    if (!manifestEntry || manifestEntry.uncompressedSize > maxManifestBytes)
      throw invalidArchive(
        "The archive needs one inventory.json within the 64 MiB metadata processing bound.",
      );
    const chunks: Buffer[] = [];
    await readEntry(
      zip,
      manifestEntry,
      () =>
        new Writable({
          write(chunk: Buffer, _encoding, done) {
            chunks.push(chunk);
            done();
          },
        }),
      controller.signal,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      );
    } catch {
      throw invalidArchive("inventory.json is not valid UTF-8 JSON.");
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      "format" in parsed &&
      parsed.format === "inventory-manager" &&
      "version" in parsed &&
      parsed.version !== 1
    )
      throw new DomainError(
        "unsupported_inventory_archive_version",
        "This inventory archive version is not supported.",
      );
    const result = inventoryManifestSchema.safeParse(parsed);
    if (!result.success)
      throw invalidArchive(
        "The inventory manifest contains invalid fields, values or references.",
      );
    const manifest: InventoryManifest = result.data;
    if (
      !Number.isSafeInteger(
        manifest.attachments.reduce((sum, file) => sum + file.byte_size, 0),
      )
    )
      throw invalidArchive(
        "The total attachment size cannot be represented safely.",
      );
    const expectedNames = new Set([
      "inventory.json",
      ...manifest.attachments.map((file) => `attachments/${file.key}`),
    ]);
    if (
      [...entries.keys()].some(
        (name) => name !== "attachments/" && !expectedNames.has(name),
      ) ||
      [...expectedNames].some((name) => !entries.has(name))
    )
      throw invalidArchive(
        "The archive files do not match the inventory manifest.",
      );
    const files = new Map<string, string>();
    for (const [index, file] of manifest.attachments.entries()) {
      controller.signal.throwIfAborted();
      const entry = entries.get(`attachments/${file.key}`)!;
      if (entry.uncompressedSize !== file.byte_size)
        throw invalidArchive("An attachment size does not match the manifest.");
      const stagedPath = join(workspace, `file-${index}`);
      await readEntry(
        zip,
        entry,
        () =>
          createWriteStream(stagedPath, {
            flags: "wx",
            mode: 0o600,
            flush: true,
          }),
        controller.signal,
        file,
      );
      files.set(file.key, stagedPath);
    }
    return { manifest, files };
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted();
    if (error instanceof DomainError) throw error;
    const reason = decodingError ?? error;
    // System storage failures should remain distinguishable from invalid archive input.
    if (
      reason instanceof Error &&
      "code" in reason &&
      /^(EACCES|EPERM|ENOSPC|EIO|EMFILE|ENFILE|EROFS)$/.test(
        String(reason.code),
      )
    )
      throw reason;
    throw invalidArchive(
      "The ZIP archive is damaged or uses an unsupported layout or compression method.",
    );
  } finally {
    signal.removeEventListener("abort", abort);
    if (zip) {
      const closed = new Promise<void>((resolve) =>
        zip!.once("close", resolve),
      );
      zip.close();
      await closed;
    }
  }
}
