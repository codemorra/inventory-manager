import { Router } from "express";
import type { Services } from "../services.js";
import { itemResponse } from "./responses.js";

/**
 * Defines the routes for managing inventory items.
 * @param services The services object containing the items service.
 * @returns An Express router with the item routes.
 */
export function itemRoutes({ items }: Services) {
  const router = Router();
  const path = "/:inventory_id/items";

  // Route for listing all items in a specific inventory
  router.get(path, (request, response) => {
    response.json(items.list(request.params.inventory_id).map(itemResponse));
  });

  // Route for creating a new item in a specific inventory
  router.post(path, (request, response) => {
    response
      .status(201)
      .json(
        itemResponse(items.create(request.params.inventory_id, request.body)),
      );
  });

  // Route for retrieving a specific item by ID
  router.get(`${path}/:item_id`, (request, response) => {
    response.json(
      itemResponse(
        items.read(request.params.inventory_id, request.params.item_id),
      ),
    );
  });

  // Route for updating a specific item by ID
  router.patch(`${path}/:item_id`, (request, response) => {
    response.json(
      itemResponse(
        items.update(
          request.params.inventory_id,
          request.params.item_id,
          request.body,
        ),
      ),
    );
  });

  // Route for deleting a specific item by ID
  router.delete(`${path}/:item_id`, (request, response) => {
    items.delete(
      request.params.inventory_id,
      request.params.item_id,
      request.body,
    );
    response.status(204).end();
  });
  return router;
}
