import { Router } from "express";
import type { Services } from "../services.js";
import type { inventoryGroups } from "../db/schema.js";

/**
 * Serialize a group without exposing deletion tombstones.
 * @param group The stored group record.
 * @returns The public group response.
 */
function groupResponse(group: typeof inventoryGroups.$inferSelect) {
  return {
    id: group.id,
    name: group.name,
    created_at: group.createdAt,
    updated_at: group.updatedAt,
  };
}

/**
 * Create HTTP routes for single-level inventory groups.
 * @param groups The persistent group service.
 * @returns The group router.
 */
export function groupRoutes({ groups }: Services) {
  const router = Router();
  router.get("/", (_request, response) =>
    response.json(groups.list().map(groupResponse)),
  );
  router.post("/", (request, response) =>
    response.status(201).json(groupResponse(groups.create(request.body))),
  );
  router.patch("/:group_id", (request, response) =>
    response.json(
      groupResponse(groups.update(request.params.group_id, request.body)),
    ),
  );
  router.delete("/:group_id", (request, response) => {
    groups.delete(request.params.group_id);
    response.status(204).end();
  });
  return router;
}
