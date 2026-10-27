import { PassThrough } from "node:stream";
import { Router } from "express";
import type { Services } from "../services.js";
import { inventoryResponse } from "./responses.js";

/**
 * Copy an archive into a validated preview, then publish its exact contents only after confirmation.
 * @param services The explicitly configured archive import service.
 * @returns Import preview, status, confirmation and cancellation endpoints.
 */
export function importRoutes({ imports }: Services) {
  const router = Router();
  if (!imports) return router;
  router.post("/", async (request, response) => {
    if (
      !request.is("application/zip") &&
      !request.is("application/octet-stream")
    ) {
      response.status(415).json({
        detail:
          "An application/zip or application/octet-stream archive body is required.",
      });
      return;
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    const input = new PassThrough();
    input.on("error", () => {});
    request.once("aborted", abort);
    request.once("error", abort);
    response.once("close", abort);
    request.pipe(input);
    let prepared;
    try {
      prepared = await imports.prepare(input, controller.signal);
      controller.signal.throwIfAborted();
      response.status(201).json(prepared);
    } catch (error) {
      if (controller.signal.aborted) {
        if (prepared) await imports.discard(prepared.id);
      } else throw error;
    } finally {
      request.off("aborted", abort);
      request.off("error", abort);
      response.off("close", abort);
      request.unpipe(input);
      input.destroy();
      if (!request.readableEnded) request.resume();
    }
  });
  router.get("/:import_id", async (request, response) => {
    response.json(await imports.read(request.params.import_id));
  });
  router.post("/:import_id/confirm", async (request, response) => {
    // Once confirmation starts, a disconnected client may recover its receipt by retrying the same token.
    response.json(
      inventoryResponse(
        await imports.confirm(request.params.import_id, request.body),
      ),
    );
  });
  router.delete("/:import_id", async (request, response) => {
    await imports.discard(request.params.import_id);
    response.status(204).end();
  });
  return router;
}
