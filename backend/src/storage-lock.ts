import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { AppConfig } from "./config.js";

/** Hold an OS-released SQLite lock across the entire backend lifetime, including relocation. */
export async function acquireStorageLock(config: AppConfig) {
  await mkdir(config.configDirectory, { recursive: true, mode: 0o700 });
  const lock = new Database(
    join(config.configDirectory, ".runtime-lock.sqlite"),
    { timeout: 0 },
  );
  try {
    lock.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    lock.close();
    throw error;
  }
  return () => lock.close();
}
