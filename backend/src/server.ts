import { createServer, type ServerResponse } from "node:http";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { openDatabase } from "./db/connection.js";
import { createLogger } from "./logging.js";
import { prepareStorage } from "./storage.js";
import { createServices } from "./services.js";
import { acquireStorageLock } from "./storage-lock.js";
import { createRuntimeActivity } from "./runtime-activity.js";
import type { AppDatabase } from "./db/types.js";
import { DomainError } from "./errors.js";

/**
 * Start the HTTP server with the given application configuration.
 * @param config The application configuration.
 * @returns An object containing the server instance, database connection, and a stop function to gracefully shut down the server.
 */
export async function startServer(config: AppConfig) {
  const baseConfig = { ...config };
  const activity = createRuntimeActivity();
  let paused: Promise<void> | undefined;
  let resume: (() => void) | undefined;
  let switching: Promise<unknown> | undefined;
  let unavailable = false;
  let shuttingDown = false;
  const logger = await createLogger(config);
  let connection: ReturnType<typeof openDatabase> | undefined;
  const server = createServer();
  let maintenance: ReturnType<typeof setInterval> | undefined;
  let attachmentService: ReturnType<typeof createServices>["attachments"] =
    null;

  let importService: ReturnType<typeof createServices>["imports"] = null;
  let exportService: ReturnType<typeof createServices>["exports"] = null;
  let releaseStorage: (() => void) | undefined;

  try {
    releaseStorage = await acquireStorageLock(config);
    config = await prepareStorage(config, (error) =>
      logger.error("Storage relocation could not be completed", error),
    );
    // Open the database connection before starting the server.
    connection = openDatabase(config.databasePath);
    // Domain services retain their sessions while each new operation uses the current connection.
    const database = new Proxy(connection.db, {
      get(_target, key) {
        const current = connection!.db;
        const value: unknown = Reflect.get(current, key, current);
        return typeof value === "function" ? value.bind(current) : value;
      },
    }) as AppDatabase;
    const services = activity.services(
      createServices(database, {
        get directory() {
          return config.attachmentsDirectory;
        },
        tempDirectory: config.tempDirectory,
        settingsPath: config.settingsPath,
        storageConfig: config,
      }),
    );
    await services.settings!.read();
    attachmentService = services.attachments;
    exportService = services.exports;
    importService = services.imports;
    const cleanup = () =>
      Promise.all([
        attachmentService!.cleanup(),
        exportService!.cleanup(),
        importService!.cleanup(),
      ]).catch((error: unknown) =>
        logger.error("Managed file cleanup will be retried", error),
      );
    await cleanup();
    maintenance = setInterval(() => {
      if (!paused && !shuttingDown && !unavailable) void cleanup();
    }, 60_000);
    maintenance.unref();
    async function relocate(input: unknown, response: ServerResponse) {
      if (paused || shuttingDown)
        throw new DomainError(
          "storage_location_conflict",
          "Storage is currently being changed.",
        );
      activity.exclude(response);
      paused = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const operation = (async () => {
        try {
          await activity.idle();
          const plan = await services.storageLocations!.schedule(input);
          if (!plan.pending) return plan;
          await cleanup();
          await activity.idle();
          connection!.close();
          const next = await prepareStorage(baseConfig, (error) =>
            logger.error("Storage relocation could not be completed", error),
          );
          connection = openDatabase(next.databasePath);
          Object.assign(config, next);
          return await services.storageLocations!.read();
        } catch (error) {
          if (!connection!.sqlite.open) {
            try {
              const recovered = await prepareStorage(baseConfig, (failure) =>
                logger.error("Storage recovery requires attention", failure),
              );
              connection = openDatabase(recovered.databasePath);
              Object.assign(config, recovered);
            } catch (failure) {
              unavailable = true;
              logger.error("Storage could not be reopened", failure);
            }
          }
          throw error;
        } finally {
          const release = resume;
          paused = undefined;
          resume = undefined;
          release?.();
        }
      })();
      switching = operation;
      return operation;
    }
    const app = createApp(logger, services, { relocate });
    server.on("request", (request, response) => {
      void (async () => {
        while (paused) await paused;
        if (response.destroyed) return;
        if (shuttingDown || unavailable) {
          response.writeHead(503, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              detail: {
                code: "application_settings_unavailable",
                message: "Application storage is unavailable.",
              },
            }),
          );
          return;
        }
        activity.request(response);
        app(request, response);
      })().catch((error: unknown) => {
        logger.error("Request dispatch failed", error);
        response.destroy();
      });
    });
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
    clearInterval(maintenance);
    connection?.close();
    releaseStorage?.();
    await logger.close();
    throw error;
  }

  let stopping: Promise<void> | undefined;
  return {
    get config() {
      return config;
    },
    server,
    get database() {
      return connection!;
    },
    stop() {
      stopping ??= (async () => {
        shuttingDown = true;
        clearInterval(maintenance);
        await switching?.catch(() => {});
        try {
          // Attempt to gracefully shut down the server.
          await new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeIdleConnections();
          });
        } finally {
          try {
            await Promise.all([
              attachmentService?.cleanup(),
              exportService?.cleanup(),
              importService?.cleanup(),
            ]);
          } catch (error) {
            logger.error(
              "Attachment cleanup will be retried on startup",
              error,
            );
          }
          await activity.idle();
          connection!.close();
          releaseStorage?.();
          logger.info("Application stopped");
          await logger.close();
        }
      })();
      return stopping;
    },
  };
}
