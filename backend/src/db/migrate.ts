import { loadConfig } from "../config.js";
import { openDatabase } from "./connection.js";

import { prepareStorage } from "../storage.js";

const config = await prepareStorage(loadConfig());
const connection = openDatabase(config.databasePath);
connection.close();
console.info("Drizzle migrations applied.");
