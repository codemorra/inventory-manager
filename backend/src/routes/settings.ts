import { Router } from "express";
import type { Services } from "../services.js";

/** Expose file-backed application preferences without accepting client filesystem paths. */
export function settingsRoutes({ settings }: Services) {
  const router = Router();
  if (!settings) return router;
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.get("/", async (_request, response) => {
    response.json(await settings.read());
  });
  router.patch("/", async (request, response) => {
    response.json(await settings.update(request.body));
  });
  router.post("/migrate", async (request, response) => {
    response.json(await settings.migrate(request.body));
  });
  return router;
}
