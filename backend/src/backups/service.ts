import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import type { AppConfig } from "../config.js";
import type { DatabaseConnection } from "../db/connection.js";
import { syncBackupDirectory } from "./sync-directory.js";
import {
  databaseFiles,
  describeFile,
  syncSnapshot,
  verifyBackup,
  writeBackup,
} from "./archive.js";
import {
  backupManifestSchema,
  invalidBackup,
  type BackupFile,
  type BackupManifest,
} from "./manifest.js";

export type BackupIdentity = Pick<BackupManifest, "id" | "created_at">;

/**
 * Derive the generated archive basename from a stable creation identity.
 * @param identity The application's UUID and canonical UTC creation timestamp.
 * @returns The immutable timestamp/UUID ZIP filename.
 */
export function backupFilename(identity: BackupIdentity) {
  return `backup-${identity.created_at.replace(/[:.]/g, "-")}-${identity.id}.zip`;
}

/**
 * Build verified full backups while the runtime holds exclusive access to managed state.
 * @param config Active paths, resolved again by the runtime after each storage change.
 * @param connection Current SQLite connection; the caller must drain other operations first.
 * @param kind The reason the backup is being created.
 * @param identity Optional durable scheduler identity used to recover a completed publication.
 * @returns The published backup identity, filename, creation time, kind and compressed byte count.
 * @throws {DomainError} When managed files or the completed archive fail validation.
 * @throws {Error} When snapshot creation, archive publication or workspace cleanup fails.
 */
export async function createBackup(
  config: AppConfig,
  connection: DatabaseConnection,
  kind: BackupManifest["kind"] = "manual",
  identity?: BackupIdentity,
) {
  const workspace = await mkdtemp(join(config.tempDirectory, "backup-"));
  // Stage beside the destination so publishing works across configured filesystems.
  let publication: string | undefined;
  try {
    const id = identity?.id ?? randomUUID();
    const createdAt = identity?.created_at ?? new Date().toISOString();
    const databasePath = join(workspace, "inventory.db");
    await connection.sqlite.backup(databasePath);
    await syncSnapshot(databasePath);
    const sources = new Map([["inventory.db", databasePath]]);
    const files: BackupFile[] = [
      await describeFile(databasePath, "inventory.db"),
    ];
    for (const attachment of databaseFiles(databasePath)) {
      if (!/^[0-9a-f-]{36}$/.test(attachment.id))
        throw invalidBackup("Invalid managed attachment identity.");
      const name = `attachments/${attachment.id}.blob`;
      const source = join(config.attachmentsDirectory, `${attachment.id}.blob`);
      const file = await describeFile(source, name);
      if (
        file.byte_size !== attachment.byte_size ||
        (attachment.sha256 !== null && file.sha256 !== attachment.sha256)
      )
        throw invalidBackup(
          "A managed attachment failed its saved size or checksum check.",
        );
      files.push(file);
      sources.set(name, source);
    }
    const manifest = backupManifestSchema.parse({
      format: "inventory-manager-backup",
      version: 1,
      id,
      created_at: createdAt,
      kind,
      files,
    });
    publication = await mkdtemp(join(config.backupsDirectory, ".backup-"));
    const archive = join(publication, "backup.zip");
    await writeBackup(archive, manifest, sources);
    await verifyBackup(archive, workspace);
    const filename = backupFilename({ id, created_at: createdAt });
    const byteSize = (await lstat(archive)).size;
    // Generated UUID names and the application lock keep atomic publication independent of hard-link support.
    await rename(archive, join(config.backupsDirectory, filename));
    await syncBackupDirectory(config.backupsDirectory);
    return {
      id,
      filename,
      created_at: createdAt,
      kind: manifest.kind,
      byte_size: byteSize,
    };
  } finally {
    await rm(workspace, { recursive: true, force: true });
    if (publication) await rm(publication, { recursive: true, force: true });
  }
}

/**
 * Reconcile only private, abandoned backup workspaces while startup owns the application lock.
 * @param config Active temporary, backup and fixed configuration directories.
 * @returns Completion once matching abandoned workspaces and scheduler write files have been removed.
 * @throws {Error} When storage directories cannot be inspected or cleaned.
 */
export async function cleanupBackupWorkspaces(config: AppConfig) {
  for (const [directory, pattern] of [
    [config.tempDirectory, /^backup-[a-zA-Z0-9]{6}$/],
    [config.backupsDirectory, /^\.backup-[a-zA-Z0-9]{6}$/],
    [config.tempDirectory, /^automatic-check-[a-zA-Z0-9]{6}$/],
  ] as const) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(directory)) {
      if (!pattern.test(name)) continue;
      const path = join(directory, name);
      if ((await lstat(path)).isDirectory())
        await rm(path, { recursive: true, force: true });
    }
  }
  for (const name of await readdir(config.configDirectory)) {
    if (!/^\.automatic-write-[0-9a-f-]{36}\.tmp$/.test(name)) continue;
    const path = join(config.configDirectory, name);
    if ((await lstat(path)).isFile()) await unlink(path);
  }
}
