import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DomainError } from "../errors.js";
import {
  defaultPreferences,
  defaultBackupPolicy,
  backupPolicyUpdateSchema,
  settingsDocumentSchema,
  settingsUpdateSchema,
  type SettingsDocument,
  type StorageLocations,
} from "./validation.js";

// Serialize all callers for a path, including independently composed services within one backend process.
const queues = new Map<string, Promise<unknown>>();
const maximumSettingsBytes = 64 * 1024;

/**
 * Read and atomically replace versioned user settings without falling back over a damaged file.
 * @param settingsPath The fixed absolute configuration file selected by startup configuration.
 * @returns Effective settings, optimistic-concurrency updates.
 */
export function createSettingsService(settingsPath: string) {
  if (!isAbsolute(settingsPath))
    throw new Error("Settings path must be absolute.");
  const path = resolve(settingsPath);
  const invalid = () =>
    new DomainError(
      "application_settings_unavailable",
      "The application settings file is unavailable, invalid or uses an unsupported version. Existing contents were preserved.",
    );
  async function readDocument(): Promise<SettingsDocument> {
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      const details = await file.stat();
      if (!details.isFile() || details.size > maximumSettingsBytes)
        throw invalid();
      const buffer = Buffer.alloc(maximumSettingsBytes + 1);
      let length = 0;
      while (length <= maximumSettingsBytes) {
        const read = await file.read(
          buffer,
          length,
          buffer.length - length,
          length,
        );
        length += read.bytesRead;
        if (!read.bytesRead) break;
      }
      if (length > maximumSettingsBytes) throw invalid();
      const parsed: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.subarray(0, length),
        ),
      );
      const result = settingsDocumentSchema.safeParse(parsed);
      if (!result.success) throw invalid();
      return result.data;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw invalid();
    } finally {
      await file?.close();
    }
  }
  const response = (document: SettingsDocument) => ({
    version: document.version,
    revision: document.revision,
    preferences: { ...defaultPreferences, ...document.preferences },
  });
  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(path) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(path, next);
    void next
      .finally(() => {
        if (queues.get(path) === next) queues.delete(path);
      })
      .catch(() => {});
    return next;
  }
  async function write(document: SettingsDocument) {
    const temporary = join(dirname(path), `.settings-${randomUUID()}.tmp`);
    let file;
    try {
      file = await open(temporary, "wx", 0o600);
      await file.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
      await file.sync();
      await file.close();
      file = undefined;
      await rename(temporary, path);
    } finally {
      await file?.close();
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  }
  function nextRevision(document: SettingsDocument) {
    if (document.revision >= Number.MAX_SAFE_INTEGER)
      throw new DomainError(
        "application_settings_conflict",
        "The settings revision is exhausted.",
      );
    return document.revision + 1;
  }
  return {
    /**
     * Read backup policy alongside the shared configuration revision.
     * @returns Effective daily/weekly policy and automatic retention count.
     * @throws {DomainError} When the settings document is unavailable or invalid.
     */
    async readBackupPolicy() {
      const document = await readDocument();
      return {
        revision: document.revision,
        policy: document.backups ?? { ...defaultBackupPolicy },
      };
    },
    /**
     * Save backup policy without replacing appearance preferences or storage locations.
     * @param input The complete policy and the user's captured settings revision.
     * @returns The accepted policy and its new configuration revision.
     * @throws {Error} When validation, revision checks or durable writing fail.
     */
    async updateBackupPolicy(input: unknown) {
      const data = backupPolicyUpdateSchema.parse(input);
      return serialize(async () => {
        const current = await readDocument();
        if (current.revision !== data.expected_revision)
          throw new DomainError(
            "application_settings_conflict",
            "The settings have changed. Reload before saving again.",
          );
        const next = {
          ...current,
          revision: nextRevision(current),
          backups: data.policy,
        };
        await write(next);
        return { revision: next.revision, policy: next.backups };
      });
    },
    async readStorageState() {
      const document = await readDocument();
      return { revision: document.revision, storage: document.storage ?? {} };
    },
    /** Serialize internal storage changes with ordinary preference writes. */
    async updateStorage(
      revision: number,
      operation: (storage: StorageLocations) => Promise<StorageLocations>,
    ) {
      return serialize(async () => {
        const current = await readDocument();
        if (current.revision !== revision)
          throw new DomainError(
            "application_settings_conflict",
            "The application settings have changed. Reload them before saving again.",
          );
        const next = {
          ...current,
          revision: nextRevision(current),
          storage: await operation(current.storage ?? {}),
        };
        await write(settingsDocumentSchema.parse(next));
        return { revision: next.revision, storage: next.storage };
      });
    },
    /** Read startup locations without exposing filesystem paths through preference responses. */
    async readStorage() {
      return (await readDocument()).storage ?? {};
    },
    async read() {
      return response(await readDocument());
    },
    async update(input: unknown) {
      const data = settingsUpdateSchema.parse(input);
      return serialize(async () => {
        const current = await readDocument();
        if (current.revision !== data.expected_revision)
          throw new DomainError(
            "application_settings_conflict",
            "The application settings have changed. Reload them before saving again.",
          );
        const next = {
          ...current,
          revision: nextRevision(current),
          preferences: { ...current.preferences, ...data.preferences },
        };
        await write(next);
        return response(next);
      });
    },
  };
}
