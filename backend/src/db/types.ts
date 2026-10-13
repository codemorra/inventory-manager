import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "./schema.js";

// Type representing the application's database connection.
export type AppDatabase = BetterSQLite3Database<typeof schema>;
