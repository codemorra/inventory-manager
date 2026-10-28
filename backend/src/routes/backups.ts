import type { ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import type { Services } from "../services.js";
import type { createAutomaticBackups } from "../backups/automatic.js";

/**
 * Expose durable backup metadata, creation, deletion and repeatable native ZIP downloads.
 * @param services Domain services with optional managed backup storage.
 * @param create The runtime operation coordinating consistent backup creation.
 * @param automatic Optional runtime-owned automatic scheduling and policy operations.
 * @returns Backup routes available in the configured runtime.
 */
export function backupRoutes(
  { backups }: Services,
  create?: (response: ServerResponse) => Promise<unknown>,
  automatic?: ReturnType<typeof createAutomaticBackups>,
) {
  const router = Router();
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  if (automatic) {
    router.get("/schedule", async (_request, response) => {
      response.json(await automatic.read());
    });
    router.put("/schedule", async (request, response) => {
      const result = await automatic.update(request.body);
      response.once("finish", () => {
        void automatic.tick();
      });
      response.json(result);
    });
  }
  if (create)
    router.post("/", async (_request, response) => {
      response.status(201).json(await create(response));
    });
  if (!backups) return router;
  router.get("/", async (_request, response) => {
    response.json(await backups.list());
  });
  router.delete("/:filename", async (request, response) => {
    await backups.remove(request.params.filename);
    response.status(204).end();
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
