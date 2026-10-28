import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { DomainError } from "./errors.js";
import { createSettingsService } from "./settings/service.js";
import {
  directorySchema,
  revisionSchema,
  type StorageLocations,
} from "./settings/validation.js";
import {
  canonicalPath,
  contains,
  resolveStorageConfig,
  validateStorageConfig,
} from "./storage-layout.js";
import { storagePath } from "./storage-paths.js";

type Move = NonNullable<StorageLocations["relocation"]>;
const keys = ["dataDirectory", "backupsDirectory"] as const;
const marker = ".inventory-manager-move.json";
const inputSchema = z.strictObject({
  expected_revision: revisionSchema,
  dataDirectory: directorySchema,
  backupsDirectory: directorySchema,
});
const cancelSchema = z.strictObject({ expected_revision: revisionSchema });
const invalid = () =>
  new DomainError(
    "storage_location_invalid",
    "Choose separate, empty destination directories with sufficient access permissions.",
  );
const conflict = () =>
  new DomainError(
    "storage_location_conflict",
    "A storage change is already pending or data storage is explicitly overridden.",
  );
const staging = (move: Move, key: (typeof keys)[number]) =>
  `${move.target[key]}.inventory-move-${move.id}`;
const previous = (move: Move, key: (typeof keys)[number]) =>
  `${move.source[key]}.inventory-old-${move.id}`;
const changed = (move: Move) =>
  keys.filter((key) => move.source[key] !== move.target[key]);

async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function owned(path: string, id: string) {
  try {
    const details = await lstat(path);
    if (!details.isDirectory() || details.isSymbolicLink()) return false;
    const entry = await lstat(join(path, marker));
    if (!entry.isFile() || entry.isSymbolicLink()) return false;
    return JSON.parse(await readFile(join(path, marker), "utf8")).id === id;
  } catch {
    return false;
  }
}
async function mark(path: string, id: string) {
  if (await owned(path, id)) return;
  const file = await open(join(path, marker), "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({ id }));
    await file.sync();
  } finally {
    await file.close();
  }
}
async function emptyDestination(path: string) {
  if (!(await exists(path))) return;
  const entry = await lstat(path);
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    (await readdir(path)).length
  )
    throw invalid();
}
async function removeOwned(path: string, id: string) {
  if (!(await exists(path))) return;
  const details = await lstat(path);
  if (!details.isDirectory() || details.isSymbolicLink()) throw invalid();
  const entries = await readdir(path);
  if (!(await owned(path, id))) {
    if (entries.length) throw invalid();
    await rmdir(path);
    return;
  }
  // Retain ownership evidence until the contents are gone, including after a partial cleanup failure.
  for (const name of entries) {
    if (name !== marker) await rm(join(path, name), { recursive: true });
  }
  await unlink(join(path, marker));
  await rmdir(path);
}

/** Hash names, file bytes and empty directories; do not follow filesystem links. */
async function digest(root: string) {
  const hash = createHash("sha256");
  async function visit(path: string, name: string) {
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) throw invalid();
    if (entry.isDirectory()) {
      hash.update(JSON.stringify(["directory", name]));
      for (const child of (await readdir(path)).sort()) {
        if (!name && child === marker) continue;
        await visit(join(path, child), `${name}/${child}`);
      }
    } else if (entry.isFile()) {
      hash.update(JSON.stringify(["file", name, entry.size]));
      const content = createHash("sha256");
      for await (const chunk of createReadStream(path)) content.update(chunk);
      hash.update(content.digest());
    } else throw invalid();
  }
  await visit(root, "");
  return hash.digest("hex");
}
async function syncFiles(root: string) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await syncFiles(path);
    else {
      const file = await open(path, "r+");
      try {
        await file.sync();
      } finally {
        await file.close();
      }
    }
  }
}
function checkDatabase(directory: string) {
  const db = new Database(join(directory, "inventory.db"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    if (db.pragma("quick_check", { simple: true }) !== "ok") throw invalid();
  } finally {
    db.close();
  }
}

/** Validate against active and fixed paths before any destructive filesystem operation. */
async function validateMove(base: AppConfig, move: Move) {
  const target = resolveStorageConfig(base, move.target);
  await validateStorageConfig(target);
  for (const key of changed(move)) {
    for (const source of Object.values(move.source)) {
      if (
        contains(source, move.target[key]) ||
        contains(move.target[key], source)
      )
        throw invalid();
    }
    // Re-resolve at execution time too; a changed symlink must never redirect the move.
    for (const path of [
      move.source[key],
      move.target[key],
      staging(move, key),
      previous(move, key),
    ]) {
      if ((await canonicalPath(path)) !== path) throw invalid();
    }
  }
}

/** Stage path changes; the running server keeps its current database and attachment services. */
export function createStorageLocationService(config: AppConfig) {
  const settings = createSettingsService(config.settingsPath);
  const movable =
    !config.databasePathOverride &&
    config.databasePath === join(config.dataDirectory, "inventory.db");
  async function read() {
    const state = await settings.readStorageState();
    return {
      revision: state.revision,
      paths: {
        dataDirectory: config.dataDirectory,
        backupsDirectory: config.backupsDirectory,
        databasePath: config.databasePath,
        settingsPath: config.settingsPath,
        logsDirectory: config.logsDirectory,
        tempDirectory: config.tempDirectory,
      },
      defaults: {
        dataDirectory: join(config.storageRoot, "data"),
        backupsDirectory: join(config.storageRoot, "backups"),
      },
      dataMovable: movable,
      pending:
        state.storage.relocation?.phase === "pending"
          ? state.storage.relocation.target
          : null,
      cleanupPending: state.storage.relocation?.phase === "cleanup",
      moveFailed: state.storage.moveFailed ?? false,
    };
  }
  return {
    read,
    async schedule(input: unknown) {
      const data = inputSchema.parse(input);
      await settings.updateStorage(data.expected_revision, async (storage) => {
        if (storage.relocation) throw conflict();
        const source = {
          dataDirectory: await canonicalPath(config.dataDirectory),
          backupsDirectory: await canonicalPath(config.backupsDirectory),
        };
        const target = {
          dataDirectory: await canonicalPath(storagePath(data.dataDirectory)),
          backupsDirectory: await canonicalPath(
            storagePath(data.backupsDirectory),
          ),
        };
        if (!movable && target.dataDirectory !== source.dataDirectory)
          throw conflict();
        const move: Move = {
          id: randomUUID(),
          phase: "pending",
          source,
          target,
        };
        try {
          await validateMove(config, move);
          for (const key of changed(move)) await emptyDestination(target[key]);
        } catch {
          throw invalid();
        }
        const next = { ...storage };
        delete next.moveFailed;
        return changed(move).length ? { ...next, relocation: move } : next;
      });
      return read();
    },
    async cancel(input: unknown) {
      const data = cancelSchema.parse(input);
      await settings.updateStorage(data.expected_revision, async (storage) => {
        if (storage.relocation?.phase === "cleanup") throw conflict();
        const next = { ...storage };
        delete next.relocation;
        delete next.moveFailed;
        return next;
      });
      return read();
    },
  };
}

async function rollback(move: Move) {
  for (const key of changed(move)) {
    const old = previous(move, key);
    if (await exists(old)) {
      if (!(await owned(old, move.id)) || (await exists(move.source[key])))
        throw invalid();
      await rename(old, move.source[key]);
    }
    if (!(await exists(move.source[key]))) throw invalid();
    if (await owned(move.source[key], move.id))
      await unlink(join(move.source[key], marker));
    if (await owned(move.target[key], move.id))
      await removeOwned(move.target[key], move.id);
    if (await owned(staging(move, key), move.id))
      await removeOwned(staging(move, key), move.id);
  }
}

/** Finish or recover a journaled move before any application database is opened. */
export async function completeStorageRelocation(
  base: AppConfig,
  onFailure?: (error: unknown) => void,
) {
  const settings = createSettingsService(base.settingsPath);
  let state = await settings.readStorageState();
  let move = state.storage.relocation;
  if (!move) return;
  if (move.phase === "pending") {
    try {
      if (
        base.databasePathOverride &&
        move.source.dataDirectory !== move.target.dataDirectory
      )
        throw conflict();
      const active = resolveStorageConfig(base, state.storage);
      if (
        (await canonicalPath(active.dataDirectory)) !==
          move.source.dataDirectory ||
        (await canonicalPath(active.backupsDirectory)) !==
          move.source.backupsDirectory
      )
        throw conflict();
      await validateMove(base, move);
      for (const key of changed(move)) {
        const old = previous(move, key);
        const source = (await exists(old)) ? old : move.source[key];
        if (source === old && !(await owned(old, move.id))) throw invalid();
        const sourceDigest = await digest(source);
        if (await owned(move.target[key], move.id)) {
          if ((await digest(move.target[key])) !== sourceDigest)
            throw invalid();
        } else {
          await emptyDestination(move.target[key]);
          const stage = staging(move, key);
          if (await exists(stage)) await removeOwned(stage, move.id);
          await mkdir(stage, { recursive: true, mode: 0o700 });
          await mark(stage, move.id);
          for (const name of await readdir(source)) {
            if (name === marker) continue;
            await cp(join(source, name), join(stage, name), {
              recursive: true,
              force: false,
              errorOnExist: true,
            });
          }
          await syncFiles(stage);
          if (
            (await digest(stage)) !== sourceDigest ||
            (await digest(source)) !== sourceDigest
          )
            throw invalid();
          if (key === "dataDirectory") checkDatabase(stage);
          if (await exists(move.target[key])) await rmdir(move.target[key]);
          await rename(stage, move.target[key]);
        }
        if (source !== old) {
          await mark(source, move.id);
          await rename(source, old);
        }
      }
      const journal = move;
      state = await settings.updateStorage(state.revision, async (storage) => ({
        ...storage,
        ...journal.target,
        moveFailed: false,
        relocation: { ...journal, phase: "cleanup" },
      }));
      move = state.storage.relocation!;
    } catch (error) {
      onFailure?.(error);
      await rollback(move);
      await settings.updateStorage(state.revision, async (storage) => {
        const next = { ...storage };
        delete next.relocation;
        return { ...next, moveFailed: true };
      });
      return;
    }
  }
  // Activated targets are authoritative. Failed source cleanup is retried at the next start.
  try {
    for (const key of changed(move)) {
      const old = previous(move, key);
      if (await exists(old)) {
        if (!(await owned(move.target[key], move.id))) throw invalid();
        await removeOwned(old, move.id);
      }
    }
    for (const key of changed(move)) {
      if (await owned(move.target[key], move.id))
        await unlink(join(move.target[key], marker));
    }
    await settings.updateStorage(state.revision, async (storage) => {
      const next = { ...storage };
      delete next.relocation;
      return next;
    });
  } catch (error) {
    onFailure?.(error);
    /* Keep the cleanup journal until all old copies have been removed. */
  }
}
