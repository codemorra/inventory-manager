import { mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";

const defaultMigrationsDirectory = fileURLToPath(
  new URL("../../drizzle/", import.meta.url),
);

/**
 * Open a connection to the SQLite database and apply Drizzle migrations.
 * @param databasePath The absolute path to the SQLite database file, or ":memory:" for an in-memory database.
 * @param migrationsDirectory The directory containing Drizzle migration files. Defaults to the standard Drizzle migrations directory.
 * @returns An object containing the Drizzle database instance, the raw SQLite connection, and a close method to close the connection.
 */
export function openDatabase(
  databasePath: string,
  migrationsDirectory = defaultMigrationsDirectory,
) {
  if (databasePath !== ":memory:") {
    if (!isAbsolute(databasePath)) {
      throw new Error("The SQLite database path must be absolute.");
    }
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  // Ensure the migrations directory exists
  const sqlite = new Database(databasePath);
  try {
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: migrationsDirectory });

    return {
      db,
      sqlite,
      close() {
        if (sqlite.open) sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

export type DatabaseConnection = ReturnType<typeof openDatabase>;
