import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { storagePath } from "./storage-paths.js";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The absolute path to the project root directory. */
const environmentSchema = z.object({
  INVENTORY_DATA_DIR: z.string().min(1).optional(),
  INVENTORY_DB_PATH: z.string().min(1).optional(),
  INVENTORY_FRONTEND_DIR: z
    .string()
    .refine(isAbsolute, "Frontend directory must be absolute.")
    .optional(),
  INVENTORY_HOST: z.string().min(1).default("127.0.0.1"),
  INVENTORY_PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  INVENTORY_LOG_LEVEL: z
    .string()
    .default("INFO")
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"])),
});

/**
 * Load and resolve the application configuration from environment variables.
 * @param environment The environment variables to load the configuration from. Defaults to process.env.
 * @param defaults Optional temporary-directory default supplied by a desktop runtime.
 * @returns The resolved application configuration.
 */
export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
  defaults: { tempDirectory?: string } = {},
) {
  const settings = environmentSchema.parse(environment);
  // Resolve the development default from the module location, independently of cwd.
  const storageRoot = settings.INVENTORY_DATA_DIR
    ? storagePath(settings.INVENTORY_DATA_DIR)
    : join(projectRoot, "InventoryData");
  const dataDirectory = join(storageRoot, "data");
  const databasePathOverride = settings.INVENTORY_DB_PATH
    ? storagePath(settings.INVENTORY_DB_PATH)
    : undefined;

  return {
    frontendDirectory: settings.INVENTORY_FRONTEND_DIR,
    storageRoot,
    configDirectory: join(storageRoot, "config"),
    settingsPath: join(storageRoot, "config", "settings.json"),
    dataDirectory,
    backupsDirectory: join(storageRoot, "backups"),
    tempDirectory: defaults.tempDirectory
      ? storagePath(defaults.tempDirectory)
      : join(storageRoot, "temp"),
    databasePathOverride,
    databasePath: databasePathOverride ?? join(dataDirectory, "inventory.db"),
    attachmentsDirectory: join(dataDirectory, "attachments"),
    logsDirectory: join(storageRoot, "logs"),
    logLevel: settings.INVENTORY_LOG_LEVEL,
    host: settings.INVENTORY_HOST,
    port: settings.INVENTORY_PORT,
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
