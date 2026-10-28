import { mkdir, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { AppConfig } from "./config.js";
import { createSettingsService } from "./settings/service.js";
import { storagePath } from "./storage-paths.js";

/**
 * Initialize runtime directories without replacing existing settings or data.
 * @param config The centrally resolved storage layout or an explicitly overridden storage root.
 */
export async function initializeStorage(config: AppConfig) {
  await initializeSettings(config);
  await Promise.all(
    [
      config.dataDirectory,
      config.attachmentsDirectory,
      config.backupsDirectory,
      config.logsDirectory,
      config.tempDirectory,
    ].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })),
  );
}

/** Create the fixed configuration directory and a settings document only when absent. */
async function initializeSettings(config: AppConfig) {
  await mkdir(config.configDirectory, { recursive: true, mode: 0o700 });
  let file;
  try {
    file = await open(config.settingsPath, "wx", 0o600);
    await file.writeFile(
      `${JSON.stringify({ version: 1 }, null, 2)}\n`,
      "utf8",
    );
    await file.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await file?.close();
  }
}

/** Resolve existing ancestors so that symlink aliases also participate in overlap checks. */
async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonicalPath(parent), relative(parent, path));
  }
}

function contains(parent: string, child: string) {
  const path = relative(parent, child);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

/** Resolve settings before opening SQLite or creating the selected data and backup directories. */
export async function prepareStorage(base: AppConfig): Promise<AppConfig> {
  await initializeSettings(base);
  const locations = await createSettingsService(
    base.settingsPath,
  ).readStorage();
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
  await initializeStorage(config);
  return config;
}
