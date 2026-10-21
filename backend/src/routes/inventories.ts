import { Router } from "express";
import type { Services } from "../services.js";
import { inventoryResponse, fieldResponse } from "./responses.js";

/**
 * Creates routes for managing inventories.
 * @param services - The application's services.
 * @returns An Express router with inventory routes.
 */
export function inventoryRoutes({ inventories, inventoryEditor }: Services) {
  const router = Router();

  // Read the editor baseline atomically instead of mixing independently cached metadata and fields.
  router.get("/:inventory_id/configuration", (request, response) => {
    const result = inventoryEditor.read(request.params.inventory_id);
    response.json({
      inventory: inventoryResponse(result.inventory),
      fields: result.fields.map(fieldResponse),
    });
  });

  // Save the editor draft as one transaction instead of separate HTTP mutations.
  router.patch("/:inventory_id/configuration", (request, response) => {
    const result = inventoryEditor.save(
      request.params.inventory_id,
      request.body,
    );
    response.json({
      inventory: inventoryResponse(result.inventory),
      fields: result.fields.map(fieldResponse),
    });
  });

  // Route for listing all inventories
  router.get("/", (_request, response) => {
    response.json(inventories.list().map(inventoryResponse));
  });

  // Route for creating a new inventory
  router.post("/", (request, response) => {
    response
      .status(201)
      .json(inventoryResponse(inventories.create(request.body)));
  });

  // Route for retrieving a specific inventory by ID
  router.get("/:inventory_id", (request, response) => {
    response.json(
      inventoryResponse(inventories.get(request.params.inventory_id)),
    );
  });

  // Route for updating a specific inventory by ID
  router.patch("/:inventory_id", (request, response) => {
    response.json(
      inventoryResponse(
        inventories.update(request.params.inventory_id, request.body),
      ),
    );
  });

  // Route for deleting a specific inventory by ID
  router.delete("/:inventory_id", (request, response) => {
    inventories.delete(request.params.inventory_id);
    response.status(204).end();
  });
  return router;
}
