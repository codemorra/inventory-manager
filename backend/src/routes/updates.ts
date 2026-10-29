import { Router } from "express";
import { createUpdateChecker } from "../updates/service.js";

/**
 * Expose manual update checks independently of inventory data and preferences.
 * @param check The checker shared by requests to this router.
 * @returns The update-check router.
 */
export function updateRoutes(check = createUpdateChecker()) {
  const router = Router();
  router.get("/", async (_request, response) => {
    response.set("Cache-Control", "no-store");
    response.json(await check());
  });
  return router;
}
