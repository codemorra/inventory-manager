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
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { cleanupBackupWorkspaces, createBackup } from "./backups/service.js";
import { createAutomaticBackups } from "./backups/automatic.js";
import {
  assertRestoreIdle,
  commitRestore,
  publishRestore,
  readRestoreReceipt,
  recoverRestore,
  stageRestore,
  type RestoreReceipt,
} from "./backups/restore-storage.js";

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
  let generation = randomUUID();
  const logger = await createLogger(config);
  let connection: ReturnType<typeof openDatabase> | undefined;
  const server = createServer();
  let maintenance: ReturnType<typeof setInterval> | undefined;
  let automatic: ReturnType<typeof createAutomaticBackups> | undefined;
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
    await cleanupBackupWorkspaces(config);
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
        services.restores!.cleanup(),
      ]).catch((error: unknown) =>
        logger.error("Managed file cleanup will be retried", error),
      );
    await cleanup();
    maintenance = setInterval(() => {
      if (!paused && !shuttingDown && !unavailable) {
        void cleanup();
        void automatic?.tick();
      }
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
          await assertRestoreIdle(config);
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
    /** Hold writes and background work until a consistent backup has been verified and published. */
    async function backup(response: ServerResponse) {
      if (paused || shuttingDown || unavailable)
        throw new DomainError(
          "backup_conflict",
          "Another storage operation is in progress.",
        );
      activity.exclude(response);
      paused = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const operation = (async () => {
        try {
          await activity.idle();
          const result = await createBackup(config, connection!);
          logger.info("Manual application backup completed");
          return result;
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
    /**
     * Invalidate old exchange sessions after the restored database becomes authoritative.
     * @param id The completed restore selection.
     * @param receipt Its durable confirmation result.
     * @returns The same successful result even when temporary cleanup requires a later retry.
     */
    async function finishRestore(id: string, receipt: RestoreReceipt) {
      generation = randomUUID();
      const results = await Promise.allSettled([
        services.imports!.reset(),
        services.exports!.reset(),
        services.restores!.complete(id, receipt),
      ]);
      for (const result of results)
        if (result.status === "rejected")
          logger.error(
            "Restore session cleanup will be retried",
            result.reason,
          );
      return receipt;
    }
    /**
     * Replace the checked data under the runtime barrier with a durable rollback journal.
     * @param id The explicitly confirmed preview identity.
     * @param response The confirming request excluded from the drain barrier.
     * @returns The durable, idempotent successful restore receipt.
     * @throws {Error} When validation, safety backup or activation fails; originals are recovered before resuming.
     */
    async function restore(id: string, response: ServerResponse) {
      const status = await services.restores!.read(id);
      if (status.status === "completed") return status.receipt;
      if (paused || shuttingDown || unavailable)
        throw new DomainError(
          "backup_conflict",
          "Another storage operation is in progress.",
        );
      activity.exclude(response);
      paused = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const operation = (async () => {
        let checked:
          | Awaited<
              ReturnType<NonNullable<typeof services.restores>["checked"]>
            >
          | undefined;
        let storageClosed = false;
        try {
          await activity.idle();
          await assertRestoreIdle(config);
          checked = await services.restores!.checked(id);
          const safety = await createBackup(config, connection!, "pre-restore");
          const journal = await stageRestore(
            config,
            checked.workspace,
            checked.manifest,
            {
              id,
              backup_id: checked.manifest.id,
              safety_backup: safety.filename,
              completed_at: new Date().toISOString(),
            },
          );
          const checkpoint = connection!.sqlite.pragma(
            "wal_checkpoint(TRUNCATE)",
          ) as { busy: number }[];
          if (checkpoint.some((entry) => entry.busy))
            throw new Error(
              "SQLite checkpoint could not drain external readers.",
            );
          connection!.close();
          storageClosed = true;
          await publishRestore(journal);
          connection = openDatabase(config.databasePath);
          const receipt = await commitRestore(config, journal);
          await recoverRestore(config, (error) =>
            logger.error("Restore cleanup will be retried", error),
          );
          logger.info("Application data restored");
          return await finishRestore(id, receipt);
        } catch (error) {
          try {
            if (storageClosed) connection!.close();
            const committed = await recoverRestore(config, (failure) =>
              logger.error("Restore cleanup will be retried", failure),
            );
            if (storageClosed) {
              if (!(await lstat(config.databasePath)).isFile())
                throw new Error("Recovered database is missing.", {
                  cause: error,
                });
              connection = openDatabase(config.databasePath);
            }
            if (committed) {
              const receipt = await readRestoreReceipt(config);
              if (!receipt || receipt.id !== id)
                throw new Error("Committed restore receipt is unavailable.", {
                  cause: error,
                });
              return await finishRestore(id, receipt);
            }
          } catch (failure) {
            unavailable = true;
            logger.error("Restore recovery requires attention", failure);
          }
          throw error;
        } finally {
          services.restores!.release(id);
          await checked
            ?.dispose()
            .catch((error: unknown) =>
              logger.error("Restore staging cleanup will be retried", error),
            );
          const release = resume;
          paused = undefined;
          resume = undefined;
          release?.();
        }
      })();
      switching = operation;
      return operation;
    }
    automatic = createAutomaticBackups(config, services.backups!, {
      onError: (error) =>
        logger.error("Automatic backup work will be retried", error),
      create: (identity) =>
        createBackup(config, connection!, "automatic", identity),
      exclusive: async (work) => {
        if (paused || shuttingDown || unavailable) return false;
        paused = new Promise<void>((resolve) => {
          resume = resolve;
        });
        const operation = (async () => {
          try {
            await activity.idle();
            await work();
            return true;
          } finally {
            const release = resume;
            paused = undefined;
            resume = undefined;
            release?.();
          }
        })();
        switching = operation;
        return operation;
      },
    });
    await automatic.tick();
    const app = createApp(logger, services, {
      relocate,
      backup,
      restore,
      generation: () => generation,
      automatic,
    });
    server.on("request", (request, response) => {
      void (async () => {
        request.headers["x-inventory-generation"] ??= generation;
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
    await automatic?.stop();
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
        await automatic?.stop();
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
