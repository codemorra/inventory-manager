import { Router } from "express";
import type { Services } from "../services.js";

/** Expose active stored views for startup and per-inventory revision-checked presentation changes. */
export function viewRoutes({ views }: Services) {
  const router = Router();
  router.use(
    [
      "/inventory-view-preferences",
      "/inventories/:inventory_id/view-preferences",
    ],
    (_request, response, next) => {
      response.set("Cache-Control", "no-store");
      next();
    },
  );
  router.get("/inventory-view-preferences", (_request, response) => {
    response.json(views.list());
  });
  const path = "/inventories/:inventory_id/view-preferences";
  router.get(path, (request, response) => {
    response.json(views.read(request.params.inventory_id));
  });
  router.put(path, (request, response) => {
    response.json(views.update(request.params.inventory_id, request.body));
  });
  return router;
}
