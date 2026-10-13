import { Router } from "express";
import type { Services } from "../services.js";
import { fieldResponse, optionResponse } from "./responses.js";

/**
 * Creates routes for managing inventory fields and their options.
 * @param services - The application's services.
 * @returns An Express router with inventory field routes.
 */
export function fieldRoutes({ fields, options }: Services) {
  const router = Router();
  const path = "/:inventory_id/fields";
  const optionPath = `${path}/:field_id/options`;

  // Route for listing all fields for a specific inventory
  router.get(path, (request, response) => {
    response.json(fields.list(request.params.inventory_id).map(fieldResponse));
  });

  // Route for creating a new field for a specific inventory
  router.post(path, (request, response) => {
    response
      .status(201)
      .json(
        fieldResponse(fields.create(request.params.inventory_id, request.body)),
      );
  });

  // Route for retrieving a specific field by ID
  router.get(`${path}/:field_id`, (request, response) => {
    response.json(
      fieldResponse(
        fields.read(request.params.inventory_id, request.params.field_id),
      ),
    );
  });

  // Route for updating a specific field by ID
  router.patch(`${path}/:field_id`, (request, response) => {
    response.json(
      fieldResponse(
        fields.update(
          request.params.inventory_id,
          request.params.field_id,
          request.body,
        ),
      ),
    );
  });

  // Route for deleting a specific field by ID
  router.delete(`${path}/:field_id`, (request, response) => {
    fields.delete(request.params.inventory_id, request.params.field_id);
    response.status(204).end();
  });

  // Route for listing all options for a specific field
  router.get(optionPath, (request, response) => {
    response.json(
      options
        .list(request.params.inventory_id, request.params.field_id)
        .map(optionResponse),
    );
  });

  // Route for creating a new option for a specific field
  router.post(optionPath, (request, response) => {
    response
      .status(201)
      .json(
        optionResponse(
          options.create(
            request.params.inventory_id,
            request.params.field_id,
            request.body,
          ),
        ),
      );
  });

  // Route for updating a specific option by ID
  router.patch(`${optionPath}/:option_id`, (request, response) => {
    response.json(
      optionResponse(
        options.update(
          request.params.inventory_id,
          request.params.field_id,
          request.params.option_id,
          request.body,
        ),
      ),
    );
  });

  // Route for deleting a specific option by ID
  router.delete(`${optionPath}/:option_id`, (request, response) => {
    options.delete(
      request.params.inventory_id,
      request.params.field_id,
      request.params.option_id,
    );
    response.status(204).end();
  });
  return router;
}
