import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DomainError } from "../errors.js";
import {
  defaultPreferences,
  settingsDocumentSchema,
  settingsMigrationSchema,
  settingsUpdateSchema,
  type SettingsDocument,
} from "./validation.js";

// Serialize all callers for a path, including independently composed services within one backend process.
const queues = new Map<string, Promise<unknown>>();
const maximumSettingsBytes = 64 * 1024;

/**
 * Read and atomically replace versioned user settings without falling back over a damaged file.
 * @param settingsPath The fixed absolute configuration file selected by startup configuration.
 * @returns Effective settings, optimistic-concurrency updates and idempotent legacy migration.
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
    ...document,
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
    /** Import only once, filling previously unconfigured keys and never overwriting file-backed choices. */
    async migrate(input: unknown) {
      const data = settingsMigrationSchema.parse(input);
      return serialize(async () => {
        const current = await readDocument();
        if (current.browser_migration_completed) return response(current);
        const next = {
          ...current,
          revision: nextRevision(current),
          preferences: { ...data.preferences, ...current.preferences },
          browser_migration_completed: true,
        };
        await write(next);
        return response(next);
      });
    },
  };
}
