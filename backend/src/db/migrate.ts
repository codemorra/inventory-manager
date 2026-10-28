import { loadConfig } from "../config.js";
import { openDatabase } from "./connection.js";

import { prepareStorage } from "../storage.js";
import { acquireStorageLock } from "../storage-lock.js";

const base = loadConfig();
const release = await acquireStorageLock(base);
try {
  const config = await prepareStorage(base);
  const connection = openDatabase(config.databasePath);
  connection.close();
  console.info("Drizzle migrations applied.");
} finally {
  release();
}
