import { Router } from "express";
import type { Services } from "../services.js";
import {
  fieldResponse,
  inventoryResponse,
  templateResponse,
} from "./responses.js";

/**
 * Expose independent template CRUD and atomic inventory creation.
 * @param services The composed domain services.
 * @returns The template router.
 */
export function templateRoutes({ templates }: Services) {
  const router = Router();
  router.get("/", (_request, response) =>
    response.json(templates.list().map(templateResponse)),
  );
  router.post("/", (request, response) =>
    response.status(201).json(templateResponse(templates.create(request.body))),
  );
  router.get("/:template_id", (request, response) =>
    response.json(templateResponse(templates.get(request.params.template_id))),
  );
  router.patch("/:template_id", (request, response) =>
    response.json(
      templateResponse(
        templates.update(request.params.template_id, request.body),
      ),
    ),
  );
  router.delete("/:template_id", (request, response) => {
    templates.delete(request.params.template_id, request.body);
    response.status(204).end();
  });
  router.post("/:template_id/inventories", (request, response) => {
    const result = templates.instantiate(
      request.params.template_id,
      request.body,
    );
    response.status(201).json({
      inventory: inventoryResponse(result.inventory),
      fields: result.fields.map(fieldResponse),
    });
  });
  return router;
}
