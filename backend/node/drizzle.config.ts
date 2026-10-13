import { fileURLToPath } from "node:url";
import { defineConfig } from "drizzle-kit";
import { loadConfig } from "./src/config.js";

export default defineConfig({
  dialect: "sqlite",
  schema: fileURLToPath(new URL("./src/db/schema.ts", import.meta.url)),
  out: fileURLToPath(new URL("./drizzle", import.meta.url)),
  dbCredentials: { url: loadConfig().databasePath },
});
