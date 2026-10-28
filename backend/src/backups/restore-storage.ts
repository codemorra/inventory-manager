import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { canonicalPath } from "../storage-layout.js";
import { DomainError } from "../errors.js";
import { describeFile, syncSnapshot } from "./archive.js";
import type { BackupManifest } from "./manifest.js";

export const restoreReceiptSchema = z.strictObject({
  id: z.uuid(),
  backup_id: z.uuid(),
  safety_backup: z.string(),
  completed_at: z.iso.datetime(),
});
export type RestoreReceipt = z.output<typeof restoreReceiptSchema>;
const journalSchema = z.strictObject({
  version: z.literal(1),
  phase: z.enum(["pending", "committed"]),
  database: z.string(),
  attachments: z.string(),
  database_hash: z.string().regex(/^[a-f0-9]{64}$/),
  receipt: restoreReceiptSchema,
});
export type RestoreJournal = z.output<typeof journalSchema>;
const marker = ".restore-owner";

/**
 * Test filesystem presence without treating permission failures as missing data.
 * @param path The exact file or directory to inspect.
 * @returns Whether the entry exists, including symbolic links.
 * @throws {Error} When storage inspection fails for another reason.
 */
async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * Sync a directory after publishing or moving durable filesystem entries.
 * @param path The parent directory whose entry changes must be flushed.
 * @returns Completion after directory synchronization where the platform supports it.
 * @throws {Error} When supported directory synchronization fails.
 */
async function syncDirectory(path: string) {
  let directory;
  try {
    directory = await open(path, "r");
    await directory.sync();
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !/^(EISDIR|EPERM|EACCES|EINVAL)$/.test(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    )
      throw error;
  } finally {
    await directory?.close();
  }
}

/**
 * Atomically persist a synced restore journal or confirmation receipt.
 * @param path The fixed internal document path.
 * @param value The validated document to serialize.
 * @returns Completion after publication and parent-directory synchronization.
 * @throws {Error} When the document cannot be saved durably.
 */
async function writeDocument(path: string, value: unknown) {
  const temporary = join(dirname(path), `.restore-write-${randomUUID()}.tmp`);
  let file;
  try {
    file = await open(temporary, "wx", 0o600);
    await file.writeFile(`${JSON.stringify(value)}\n`);
    await file.sync();
    await file.close();
    file = undefined;
    await rename(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await file?.close();
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

/**
 * Read a bounded regular internal document, rejecting links and oversized content.
 * @param path The fixed internal journal or receipt path.
 * @returns Parsed JSON, or null when no document exists.
 * @throws {Error} When the document cannot be read or decoded.
 */
async function readDocument(path: string): Promise<unknown> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const details = await file.stat();
    if (!details.isFile() || details.size > 64 * 1024)
      throw new Error("Invalid restore state document.");
    return JSON.parse(await file.readFile("utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  } finally {
    await file?.close();
  }
}

/**
 * Resolve owned staging directories beside each active data resource.
 * @param journal The persisted operation identity and canonical target paths.
 * @returns Same-filesystem staging directories for the database and attachments.
 */
export function restoreContainers(journal: RestoreJournal) {
  return [
    join(
      dirname(journal.database),
      `.inventory-restore-${journal.receipt.id}-db`,
    ),
    join(
      dirname(journal.attachments),
      `.inventory-restore-${journal.receipt.id}-files`,
    ),
  ] as const;
}

/**
 * Reject overlapping storage changes until any previous restore journal is resolved.
 * @param config The active application's fixed configuration directory.
 * @returns Completion when a new storage operation may proceed.
 * @throws {DomainError} When restore recovery or cleanup remains pending.
 */
export async function assertRestoreIdle(config: AppConfig) {
  if (await exists(join(config.configDirectory, ".restore-journal.json")))
    throw new DomainError(
      "backup_conflict",
      "Restore recovery or cleanup is still pending.",
    );
}

/**
 * Read the latest durable restore result for lost-response recovery.
 * @param config The application's fixed configuration directory.
 * @returns The last successful receipt, or null before the first restoration.
 * @throws {Error} When the saved receipt is invalid or unreadable.
 */
export async function readRestoreReceipt(
  config: AppConfig,
): Promise<RestoreReceipt | null> {
  const pending = await readDocument(
    join(config.configDirectory, ".restore-journal.json"),
  );
  if (pending !== null) {
    const journal = journalSchema.parse(pending);
    if (journal.phase === "committed") return journal.receipt;
  }
  const value = await readDocument(
    join(config.configDirectory, ".restore-receipt.json"),
  );
  return value === null ? null : restoreReceiptSchema.parse(value);
}

/**
 * Create checked same-filesystem copies before closing or replacing active storage.
 * @param config The current target directories, including an independent database override.
 * @param workspace The freshly extracted and validated restore contents.
 * @param manifest The immutable archive metadata.
 * @param receipt The selected operation and its already completed safety backup.
 * @returns A persisted pending activation journal.
 * @throws {Error} When staging, verification or durable journaling fails.
 */
export async function stageRestore(
  config: AppConfig,
  workspace: string,
  manifest: BackupManifest,
  receipt: RestoreReceipt,
): Promise<RestoreJournal> {
  await assertRestoreIdle(config);
  const sourceDatabase = join(workspace, "verified.db");
  const sqlite = new Database(sourceDatabase, { fileMustExist: true });
  try {
    sqlite.pragma("journal_mode = DELETE");
  } finally {
    sqlite.close();
  }
  await syncSnapshot(sourceDatabase);
  const journal: RestoreJournal = {
    version: 1,
    phase: "pending",
    database: await canonicalPath(config.databasePath),
    attachments: await canonicalPath(config.attachmentsDirectory),
    database_hash: (await describeFile(sourceDatabase, "inventory.db")).sha256,
    receipt,
  };
  await writeDocument(
    join(config.configDirectory, ".restore-journal.json"),
    journal,
  );
  const [database, attachments] = restoreContainers(journal);
  for (const directory of [database, attachments]) {
    await mkdir(directory, { mode: 0o700 });
    await writeDocument(join(directory, marker), { id: receipt.id });
  }
  await mkdir(join(attachments, "incoming"), { mode: 0o700 });
  await writeDocument(join(attachments, "incoming", marker), {
    id: receipt.id,
  });
  await copyFile(
    sourceDatabase,
    join(database, "incoming"),
    constants.COPYFILE_EXCL,
  );
  await syncSnapshot(join(database, "incoming"));
  if (
    (await describeFile(join(database, "incoming"), "inventory.db")).sha256 !==
    journal.database_hash
  )
    throw new Error("Restore database copy changed.");
  for (const file of manifest.files) {
    if (file.path === "inventory.db") continue;
    const name = file.path.slice("attachments/".length);
    const target = join(attachments, "incoming", name);
    await copyFile(
      join(workspace, "attachments", name),
      target,
      constants.COPYFILE_EXCL,
    );
    await syncSnapshot(target);
    const copied = await describeFile(target, file.path);
    if (copied.byte_size !== file.byte_size || copied.sha256 !== file.sha256)
      throw new Error("Restore attachment copy changed.");
  }
  await syncDirectory(join(attachments, "incoming"));
  await syncDirectory(database);
  await syncDirectory(attachments);
  return journal;
}

/**
 * Replace closed resources while retaining their originals inside owned containers.
 * @param journal The fully staged pending operation.
 * @returns Completion after both replacements have been published.
 * @throws {Error} When a target or rename is unavailable; recovery must then roll back.
 */
export async function publishRestore(journal: RestoreJournal) {
  const containers = restoreContainers(journal);
  for (const suffix of ["-wal", "-shm", "-journal"])
    if (await exists(`${journal.database}${suffix}`))
      throw new Error("SQLite sidecars remain after closing storage.");
  for (const [index, target] of [
    journal.database,
    journal.attachments,
  ].entries()) {
    await rename(target, join(containers[index]!, "previous"));
    await syncDirectory(dirname(target));
    await syncDirectory(containers[index]!);
    await rename(join(containers[index]!, "incoming"), target);
    await syncDirectory(dirname(target));
    await syncDirectory(containers[index]!);
  }
}

/**
 * Persist successful activation before requests can mutate the restored database.
 * @param config The application's fixed configuration directory.
 * @param journal The operation whose new database has reopened successfully.
 * @returns The durable successful restore receipt.
 * @throws {Error} When the activation decision cannot be saved.
 */
export async function commitRestore(
  config: AppConfig,
  journal: RestoreJournal,
) {
  journal.receipt.completed_at = new Date().toISOString();
  await writeDocument(join(config.configDirectory, ".restore-journal.json"), {
    ...journal,
    phase: "committed",
  });
  return journal.receipt;
}

/**
 * Recover interrupted activation before opening SQLite, or clean retained originals after commit.
 * @param config The selected runtime paths resolved before storage relocation.
 * @param onCleanupFailure Optional reporter allowing committed storage to remain usable during cleanup retries.
 * @returns Whether the current journal recorded a successful activation.
 * @throws {Error} When ownership, paths or original data cannot be established safely.
 */
export async function recoverRestore(
  config: AppConfig,
  onCleanupFailure?: (error: unknown) => void,
): Promise<boolean> {
  const journalPath = join(config.configDirectory, ".restore-journal.json");
  const value = await readDocument(journalPath);
  if (value === null) return false;
  const journal = journalSchema.parse(value);
  if (
    journal.database !== (await canonicalPath(config.databasePath)) ||
    journal.attachments !== (await canonicalPath(config.attachmentsDirectory))
  )
    throw new Error("Restore target paths have changed.");
  const containers = restoreContainers(journal);
  for (const directory of containers) {
    if (!(await exists(directory))) continue;
    if (
      !(await lstat(directory)).isDirectory() ||
      (await canonicalPath(directory)) !== directory
    )
      throw new Error("Invalid restore staging directory.");
    let owner: unknown;
    try {
      owner = await readDocument(join(directory, marker));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      owner = null;
    }
    if (
      !owner ||
      typeof owner !== "object" ||
      !("id" in owner) ||
      owner.id !== journal.receipt.id
    ) {
      const entries = await readdir(directory);
      // Initial marker publication can be interrupted before any incoming or retained data exists.
      if (
        owner !== null ||
        entries.some(
          (name) =>
            name !== marker &&
            !/^\.restore-write-[0-9a-f-]{36}\.tmp$/.test(name),
        )
      )
        throw new Error("Restore staging ownership is unavailable.");
      for (const name of entries) {
        const path = join(directory, name);
        if (!(await lstat(path)).isFile())
          throw new Error("Unrecognized restore initialization entry.");
        await unlink(path);
      }
      await rmdir(directory);
    }
  }
  if (journal.phase === "pending") {
    for (const [index, target] of [
      journal.database,
      journal.attachments,
    ].entries()) {
      const previous = join(containers[index]!, "previous");
      if (await exists(previous)) {
        if (await exists(target)) {
          if (index === 0) {
            if (
              (await describeFile(target, "inventory.db")).sha256 !==
              journal.database_hash
            )
              throw new Error("Unrecognized database during restore rollback.");
          } else {
            const owner = await readDocument(join(target, marker));
            if (
              !owner ||
              typeof owner !== "object" ||
              !("id" in owner) ||
              owner.id !== journal.receipt.id
            )
              throw new Error(
                "Unrecognized attachments during restore rollback.",
              );
          }
          await rm(target, { recursive: index === 1 });
        }
        await rename(previous, target);
        await syncDirectory(dirname(target));
      }
      if (!(await exists(target)))
        throw new Error(
          "Original storage is unavailable during restore recovery.",
        );
    }
  } else {
    if (
      !(await exists(journal.database)) ||
      !(await exists(journal.attachments))
    )
      throw new Error("Committed restore storage is missing.");
  }
  try {
    if (journal.phase === "committed") {
      await writeDocument(
        join(config.configDirectory, ".restore-receipt.json"),
        journal.receipt,
      );
      await unlink(join(journal.attachments, marker)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        },
      );
    }
    // Keep ownership evidence until each container is empty so interrupted cleanup remains retryable.
    for (const directory of containers) {
      if (!(await exists(directory))) continue;
      for (const name of await readdir(directory))
        if (name !== marker)
          await rm(join(directory, name), { recursive: true });
      await unlink(join(directory, marker));
      await rmdir(directory);
      await syncDirectory(dirname(directory));
    }
    await unlink(journalPath);
    await syncDirectory(config.configDirectory);
  } catch (error) {
    if (journal.phase !== "committed" || !onCleanupFailure) throw error;
    onCleanupFailure(error);
  }
  return journal.phase === "committed";
}
