import { mkdir, open } from "node:fs/promises";
import type { AppConfig } from "./config.js";
import { createSettingsService } from "./settings/service.js";
import {
  resolveStorageConfig,
  validateStorageConfig,
} from "./storage-layout.js";
import { completeStorageRelocation } from "./storage-relocation.js";

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

/** Resolve settings before opening SQLite or creating the selected data and backup directories. */
export async function prepareStorage(
  base: AppConfig,
  onMoveFailure?: (error: unknown) => void,
): Promise<AppConfig> {
  await initializeSettings(base);
  await completeStorageRelocation(base, onMoveFailure);
  const locations = await createSettingsService(
    base.settingsPath,
  ).readStorage();
  const config = resolveStorageConfig(base, locations);
  await validateStorageConfig(config);
  await initializeStorage(config);
  return config;
}
