import cors from "cors";
import express from "express";
import type { ErrorRequestHandler } from "express";
import type { Logger } from "./logging.js";

/**
 * Create and configure an Express application instance.
 * @param logger A logger instance with an "error" method for logging unexpected errors.
 * @returns The configured Express application instance.
 */
export function createApp(logger: Pick<Logger, "error">) {
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
  app.use(express.json({ limit: "1mb" }));

  // Health check endpoint
  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  // 404 handler for unknown routes
  app.use((_request, response) => {
    response.status(404).json({ detail: "Not Found" });
  });

  // Global error handler for unexpected errors
  const handleError: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    // Parser errors are transport concerns; unexpected errors never expose stack traces.
    if (error instanceof Error && "type" in error) {
      if (error.type === "entity.too.large") {
        response.status(413).json({ detail: "Request body too large." });
        return;
      }
      if (error.type === "entity.parse.failed") {
        response.status(422).json({
          detail: [
            { type: "json_invalid", loc: ["body"], msg: "Invalid JSON." },
          ],
        });
        return;
      }
    }
    logger.error("Unexpected request error", error);
    response.status(500).json({ detail: "Internal Server Error" });
  };
  app.use(handleError);
  return app;
}
