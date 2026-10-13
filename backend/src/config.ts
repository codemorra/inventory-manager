import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The absolute path to the project root directory. */
const environmentSchema = z.object({
  INVENTORY_DATA_DIR: z.string().min(1).optional(),
  INVENTORY_DB_PATH: z.string().min(1).optional(),
  INVENTORY_HOST: z.string().min(1).default("127.0.0.1"),
  INVENTORY_PORT: z.coerce.number().int().min(1).max(65535).default(8000),
  INVENTORY_LOG_LEVEL: z
    .string()
    .default("INFO")
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"])),
});

/**
 * Expand a potentially relative path to an absolute path, resolving "~" to the user's home directory.
 * @param value The path to expand.
 * @returns The absolute path.
 */
function absolutePath(value: string): string {
  const expanded =
    value === "~"
      ? homedir()
      : value.startsWith("~/")
        ? join(homedir(), value.slice(2))
        : value;
  if (!isAbsolute(expanded)) {
    throw new Error(
      "Inventory storage paths must be absolute (or start with ~/).",
    );
  }
  return resolve(expanded);
}

/**
 * Load and resolve the application configuration from environment variables.
 * @param environment The environment variables to load the configuration from. Defaults to process.env.
 * @returns The resolved application configuration.
 */
export function loadConfig(environment: NodeJS.ProcessEnv = process.env) {
  const settings = environmentSchema.parse(environment);
  // Resolve the development default from the module location, independently of cwd.
  const dataDirectory = settings.INVENTORY_DATA_DIR
    ? absolutePath(settings.INVENTORY_DATA_DIR)
    : join(projectRoot, "InventoryData", "node");

  return {
    dataDirectory,
    databasePath: settings.INVENTORY_DB_PATH
      ? absolutePath(settings.INVENTORY_DB_PATH)
      : join(dataDirectory, "inventory.db"),
    attachmentsDirectory: join(dataDirectory, "attachments"),
    logsDirectory: join(dataDirectory, "logs"),
    logLevel: settings.INVENTORY_LOG_LEVEL,
    host: settings.INVENTORY_HOST,
    port: settings.INVENTORY_PORT,
  };
}

export type AppConfig = ReturnType<typeof loadConfig>;
