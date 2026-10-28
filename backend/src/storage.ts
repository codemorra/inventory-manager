import { mkdir, open } from "node:fs/promises";
import type { AppConfig } from "./config.js";

/**
 * Initialize repository-local runtime directories without replacing existing settings or data.
 * @param config The centrally resolved storage layout or an explicitly overridden storage root.
 */
export async function initializeStorage(config: AppConfig) {
  await Promise.all(
    [
      config.configDirectory,
      config.dataDirectory,
      config.attachmentsDirectory,
      config.backupsDirectory,
      config.logsDirectory,
      config.tempDirectory,
    ].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })),
  );
  let file;
  try {
    file = await open(config.settingsPath, "wx", 0o600);
    // Reserve a versioned settings document; preference reading/migration follows in the next section.
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
