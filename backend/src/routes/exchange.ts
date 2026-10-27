import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import type { Services } from "../services.js";

/**
 * Prepare archives with structured errors, then download completed files without browser buffering.
 * @param services The composed export and domain services.
 * @returns Prepared export creation, single-use download, and cancellation endpoints.
 */
export function exchangeRoutes({ exports }: Services) {
  const router = Router();
  if (!exports) return router;
  const path = "/:inventory_id/exports";
  router.post(path, async (request, response) => {
    const controller = new AbortController();
    const disconnect = () => controller.abort();
    response.once("close", disconnect);
    let prepared;
    try {
      prepared = await exports.prepare(
        request.params.inventory_id,
        controller.signal,
      );
      controller.signal.throwIfAborted();
      response.status(201).json(prepared);
    } catch (error) {
      if (controller.signal.aborted) {
        if (prepared)
          await (
            await exports.take(request.params.inventory_id, prepared.id)
          ).dispose();
      } else throw error;
    } finally {
      response.off("close", disconnect);
    }
  });
  // A header probe must not consume the single-use artifact.
  router.head(`${path}/:export_id/download`, (_request, response) => {
    response.sendStatus(405);
  });
  router.get(`${path}/:export_id/download`, async (request, response) => {
    const artifact = await exports.take(
      request.params.inventory_id,
      request.params.export_id,
    );
    try {
      response
        .attachment(artifact.filename)
        .type("application/zip")
        .set({
          "Content-Length": String(artifact.byteSize),
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
      await pipeline(createReadStream(artifact.path), response);
    } finally {
      await artifact.dispose();
    }
  });
  router.delete(`${path}/:export_id`, async (request, response) => {
    await (
      await exports.take(request.params.inventory_id, request.params.export_id)
    ).dispose();
    response.status(204).end();
  });
  return router;
}
