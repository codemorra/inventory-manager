import { loadConfig } from "../config.js";
import { openDatabase } from "./connection.js";

import { initializeStorage } from "../storage.js";

const config = loadConfig();
await initializeStorage(config);
const connection = openDatabase(config.databasePath);
connection.close();
console.info("Drizzle migrations applied.");
