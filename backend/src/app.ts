import type { ServerResponse } from "node:http";
import { updateRoutes } from "./routes/updates.js";
import { settingsRoutes } from "./routes/settings.js";
import { storageRoutes } from "./routes/storage.js";
import { backupRoutes } from "./routes/backups.js";
import { restoreRoutes } from "./routes/restores.js";
import { DomainError } from "./errors.js";
import type { createAutomaticBackups } from "./backups/automatic.js";
import { viewRoutes } from "./routes/views.js";
import cors from "cors";
import express from "express";
import type { Logger } from "./logging.js";
import type { Services } from "./services.js";
import { inventoryRoutes } from "./routes/inventories.js";
import { fieldRoutes } from "./routes/fields.js";
import { itemRoutes } from "./routes/items.js";
import { errorHandler } from "./routes/error-handler.js";
import { docsRoutes } from "./routes/docs.js";
import { groupRoutes } from "./routes/groups.js";
import { templateRoutes } from "./routes/templates.js";
import { importRoutes } from "./routes/imports.js";
import { exchangeRoutes } from "./routes/exchange.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { registerFrontendServing } from "./frontend-serving.js";

/**
 * Create and configure an Express application instance.
 * @param logger A logger instance with an "error" method for logging unexpected errors.
 * @param services The domain services with an already initialized database.
 * @param options Optional storage coordination, data-generation callbacks and production frontend directory.
 * @returns The configured Express application instance.
 */
export function createApp(
  logger: Pick<Logger, "error">,
  services: Services,
  options: {
    relocate?: (input: unknown, response: ServerResponse) => Promise<unknown>;
    backup?: (response: ServerResponse) => Promise<unknown>;
    restore?: (id: string, response: ServerResponse) => Promise<unknown>;
    generation?: () => string;
    automatic?: ReturnType<typeof createAutomaticBackups>;
    frontendDirectory?: string | undefined;
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
      methods: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
      credentials: false,
      optionsSuccessStatus: 200,
      exposedHeaders: ["X-Inventory-Generation"],
    }),
  );
  app.use((request, response, next) => {
    const generation = options.generation?.();
    if (generation) {
      response.set("X-Inventory-Generation", generation);
      if (
        !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        request.get("X-Inventory-Generation") &&
        request.get("X-Inventory-Generation") !== generation
      ) {
        next(
          new DomainError(
            "application_data_changed",
            "The application data has changed. Reload before editing.",
          ),
        );
        return;
      }
    }
    next();
  });
  // JSON body parser middleware
  app.use(express.json({ limit: "1mb" }));
  const api = express.Router();
  // Physical file removal must follow committed mutations, including field/inventory cascades.
  api.use((request, response, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      !/^\/storage-locations(?:\/|$)/i.test(request.path)
    )
      response.once("finish", () => {
        void services.attachments
          ?.cleanup(false)
          .catch((error: unknown) =>
            logger.error("Attachment cleanup will be retried", error),
          );
      });
    next();
  });

  // Health check endpoint
  api.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  api.use(docsRoutes("/api"));
  api.use("/application-update", updateRoutes());
  api.use("/application-settings", settingsRoutes(services));
  api.use("/storage-locations", storageRoutes(services, options.relocate));
  api.use(
    "/backups",
    backupRoutes(services, options.backup, options.automatic),
  );
  api.use("/backup-restores", restoreRoutes(services, options.restore));
  api.use(viewRoutes(services));
  api.use("/inventory-groups", groupRoutes(services));
  api.use("/inventory-templates", templateRoutes(services));
  api.use("/inventory-imports", importRoutes(services));

  // Inventory-related routes
  api.use(
    "/inventories",
    inventoryRoutes(services),
    fieldRoutes(services),
    itemRoutes(services),
    attachmentRoutes(services),
    exchangeRoutes(services),
  );

  // Keep API misses out of the browser router, including requests accepting HTML.
  api.use((_request, response) => {
    response.status(404).json({ detail: "Not Found" });
  });
  app.use("/api", api);
  if (options.frontendDirectory) {
    // Preserve operational endpoints outside the API prefix.
    app.get(/^\/(?:health|docs|redoc|openapi\.json)\/?$/, api);
    registerFrontendServing(app, options.frontendDirectory);
  } else {
    // Development clients retain their existing unprefixed API addresses.
    app.use(api);
  }

  // 404 handler for unknown routes
  app.use((_request, response) => {
    response.status(404).json({ detail: "Not Found" });
  });

  // Error handling middleware
  app.use(errorHandler(logger));
  return app;
}
