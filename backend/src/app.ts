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

/**
 * Create and configure an Express application instance.
 * @param logger A logger instance with an "error" method for logging unexpected errors.
 * @param services The domain services with an already initialized database.
 * @returns The configured Express application instance.
 */
export function createApp(logger: Pick<Logger, "error">, services: Services) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
      methods: ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
      credentials: false,
      optionsSuccessStatus: 200,
    }),
  );
  // JSON body parser middleware
  app.use(express.json({ limit: "1mb" }));

  // Health check endpoint
  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  app.use(docsRoutes());
  app.use("/inventory-groups", groupRoutes(services));

  // Inventory-related routes
  app.use(
    "/inventories",
    inventoryRoutes(services),
    fieldRoutes(services),
    itemRoutes(services),
  );

  // 404 handler for unknown routes
  app.use((_request, response) => {
    response.status(404).json({ detail: "Not Found" });
  });

  // Error handling middleware
  app.use(errorHandler(logger));
  return app;
}
