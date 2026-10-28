import type { ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import type { Services } from "../services.js";

/**
 * Expose durable backup metadata, creation and repeatable native ZIP downloads.
 * @param services Domain services with optional managed backup storage.
 * @param create The runtime operation coordinating consistent backup creation.
 * @returns Backup routes available in the configured runtime.
 */
export function backupRoutes(
  { backups }: Services,
  create?: (response: ServerResponse) => Promise<unknown>,
) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  if (create)
    router.post("/", async (_request, response) => {
      response.status(201).json(await create(response));
    });
  if (!backups) return router;
  router.get("/", async (_request, response) => {
    response.json(await backups.list());
  });
  router.get("/:filename/download", async (request, response) => {
    const backup = await backups.download(request.params.filename);
    try {
      response
        .attachment(backup.filename)
        .type("application/zip")
        .set({
          "Content-Length": String(backup.byte_size),
          "X-Content-Type-Options": "nosniff",
        });
      if (request.method === "HEAD") response.end();
      else await pipeline(backup.stream, response);
    } finally {
      backup.stream.destroy();
    }
  });
  return router;
}
