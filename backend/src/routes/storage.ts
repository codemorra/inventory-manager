import type { ServerResponse } from "node:http";
import { Router } from "express";
import { DomainError } from "../errors.js";
import type { Services } from "../services.js";

/** Expose active paths and revision-checked live storage changes. */
export function storageRoutes(
  { storageLocations }: Services,
  relocate?: (input: unknown, response: ServerResponse) => Promise<unknown>,
) {
  const router = Router();
  if (!storageLocations) return router;
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.get("/", async (_request, response) => {
    response.json(await storageLocations.read());
  });
  router.put("/", async (request, response) => {
    if (!relocate)
      throw new DomainError(
        "storage_location_conflict",
        "Live storage changes are unavailable in this runtime.",
      );
    response.json(await relocate(request.body, response));
  });
  router.delete("/", async (request, response) => {
    response.json(await storageLocations.cancel(request.body));
  });
  return router;
}
