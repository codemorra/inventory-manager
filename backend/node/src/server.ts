import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { createLogger } from "./logging.js";
import { createServices } from "./services.js";

/**
 * Start the HTTP server with the given application configuration.
 * @param config The application configuration.
 * @returns An object containing the server instance, database connection, and a stop function to gracefully shut down the server.
 */
export async function startServer(config: AppConfig) {
  await mkdir(config.attachmentsDirectory, { recursive: true });
  const logger = await createLogger(config);
  let connection: ReturnType<typeof openDatabase> | undefined;
  const server = createServer();

  try {
    // Open the database connection before starting the server.
    connection = openDatabase(config.databasePath);
    server.on("request", createApp(logger, createServices(connection.db)));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, config.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    logger.info("Application started");
  } catch (error) {
    logger.error("Application startup failed", error);
    connection?.close();
    await logger.close();
    throw error;
  }

  const database = connection;
  let stopping: Promise<void> | undefined;
  return {
    server,
    database,
    stop() {
      stopping ??= (async () => {
        try {
          // Attempt to gracefully shut down the server.
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeIdleConnections();
          });
        } finally {
          database.close();
          logger.info("Application stopped");
          await logger.close();
        }
      })();
      return stopping;
    },
  };
}
