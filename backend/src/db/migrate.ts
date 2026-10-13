import { loadConfig } from "../config.js";
import { openDatabase } from "./connection.js";

const connection = openDatabase(loadConfig().databasePath);
connection.close();
console.info("Drizzle migrations applied.");
