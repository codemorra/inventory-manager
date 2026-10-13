import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

try {
  // Load the application configuration and start the server.
  const runtime = await startServer(loadConfig());
  const shutdown = () => {
    void runtime.stop().catch((error: unknown) => {
      console.error("Application shutdown failed:", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
} catch (error) {
  console.error("Application startup failed:", error);
  process.exitCode = 1;
}
