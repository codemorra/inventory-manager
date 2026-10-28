import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { DomainError } from "../errors.js";
import { backupFilename } from "./service.js";
import { syncBackupDirectory } from "./sync-directory.js";

const identitySchema = z.strictObject({
  id: z.uuid(),
  created_at: z.iso
    .datetime()
    .refine((value) => new Date(value).toISOString() === value),
});
export const automaticRecordSchema = identitySchema
  .extend({ filename: z.string(), completed_at: z.iso.datetime() })
  .refine((record) => record.filename === backupFilename(record));
export type AutomaticRecord = z.output<typeof automaticRecordSchema>;
export const automaticFailureSchema = z.strictObject({
  at: z.iso.datetime(),
  stage: z.enum(["backup", "retention"]),
});
export type AutomaticFailure = z.output<typeof automaticFailureSchema>;
const stateSchema = z
  .strictObject({
    version: z.literal(1),
    pending: identitySchema.nullable(),
    last_success: automaticRecordSchema.nullable(),
    archives: z.array(automaticRecordSchema).max(50_000),
    retention_pending: z.boolean(),
    last_failure: automaticFailureSchema.nullable(),
  })
  .refine(
    (state) =>
      new Set(state.archives.map((entry) => entry.id)).size ===
      state.archives.length,
  );
export type AutomaticState = z.output<typeof stateSchema>;
const maximumStateBytes = 16 * 1024 * 1024;

/**
 * Create independent empty operational state before any automatic attempt has run.
 * @returns A fresh ledger with no successful or pending automatic backups.
 */
export function emptyAutomaticState(): AutomaticState {
  return {
    version: 1,
    pending: null,
    last_success: null,
    archives: [],
    retention_pending: false,
    last_failure: null,
  };
}

/**
 * Load the bounded, regular automatic-backup ledger without resetting damaged state.
 * @param config The application's fixed configuration directory.
 * @returns The recorded attempts and managed archives, or empty state for a new installation.
 * @throws {DomainError} When existing state cannot be safely read or validated.
 */
export async function readAutomaticState(
  config: AppConfig,
): Promise<AutomaticState> {
  let file;
  try {
    file = await open(
      join(config.configDirectory, ".automatic-backups.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const details = await file.stat();
    if (!details.isFile() || details.size > maximumStateBytes)
      throw new Error("Invalid automatic backup state.");
    let length = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      const bytes = chunk as Buffer;
      length += bytes.length;
      if (length > maximumStateBytes)
        throw new Error("Automatic backup state exceeds its processing bound.");
      chunks.push(bytes);
    }
    return stateSchema.parse(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return emptyAutomaticState();
    throw new DomainError(
      "backup_schedule_unavailable",
      "Automatic backup status is unavailable. Existing state was preserved.",
    );
  } finally {
    await file?.close();
  }
}

/**
 * Atomically replace the scheduler's validated operational ledger.
 * @param config The application's fixed configuration directory.
 * @param state Pending publication, successful archives and retention progress.
 * @returns Completion after the state file has been flushed and published.
 * @throws {Error} When validation or durable publication fails.
 */
export async function writeAutomaticState(
  config: AppConfig,
  state: AutomaticState,
) {
  const bytes = `${JSON.stringify(stateSchema.parse(state))}\n`;
  if (Buffer.byteLength(bytes) > maximumStateBytes)
    throw new Error("Automatic backup state exceeds its processing bound.");
  const temporary = join(
    config.configDirectory,
    `.automatic-write-${randomUUID()}.tmp`,
  );
  let file;
  try {
    file = await open(temporary, "wx", 0o600);
    await file.writeFile(bytes);
    await file.sync();
    await file.close();
    file = undefined;
    await rename(
      temporary,
      join(config.configDirectory, ".automatic-backups.json"),
    );
    await syncBackupDirectory(config.configDirectory);
  } finally {
    await file?.close();
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
