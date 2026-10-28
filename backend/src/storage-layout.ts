import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { AppConfig } from "./config.js";
import type { StorageLocations } from "./settings/validation.js";
import { storagePath } from "./storage-paths.js";

/** Resolve existing ancestors so that symlink aliases also participate in overlap checks. */
export async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonicalPath(parent), relative(parent, path));
  }
}

export function contains(parent: string, child: string) {
  const path = relative(parent, child);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

/** Resolve selected directories without touching their contents. */
export function resolveStorageConfig(
  base: AppConfig,
  locations: StorageLocations,
): AppConfig {
  const dataDirectory = locations.dataDirectory
    ? storagePath(locations.dataDirectory)
    : base.dataDirectory;
  const config: AppConfig = {
    ...base,
    dataDirectory,
    databasePath:
      base.databasePathOverride ??
      (locations.dataDirectory
        ? join(dataDirectory, "inventory.db")
        : base.databasePath),
    attachmentsDirectory: locations.dataDirectory
      ? join(dataDirectory, "attachments")
      : base.attachmentsDirectory,
    backupsDirectory: locations.backupsDirectory
      ? storagePath(locations.backupsDirectory)
      : base.backupsDirectory,
  };
  return config;
}

/** Keep managed data, backups and application working files separate. */
export async function validateStorageConfig(config: AppConfig) {
  const [data, backups, settings, logs, temporary, database, attachments] =
    await Promise.all([
      canonicalPath(config.dataDirectory),
      canonicalPath(config.backupsDirectory),
      canonicalPath(config.configDirectory),
      canonicalPath(config.logsDirectory),
      canonicalPath(config.tempDirectory),
      canonicalPath(config.databasePath),
      canonicalPath(config.attachmentsDirectory),
    ]);
  const overlaps = (a: string, b: string) => contains(a, b) || contains(b, a);
  if (
    overlaps(data, backups) ||
    [settings, logs, temporary].some(
      (fixed) => overlaps(data, fixed) || overlaps(backups, fixed),
    ) ||
    [backups, settings, logs, temporary, attachments].some((directory) =>
      contains(directory, database),
    )
  ) {
    throw new Error(
      "Data, backups, configuration, logs and temporary storage must use separate directories.",
    );
  }
}
