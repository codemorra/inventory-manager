import { PassThrough } from "node:stream";
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../services.js";
import { inventoryResponse } from "./responses.js";

/**
 * Preview foreign tables separately from ZIP exchange, then publish an explicit validated interpretation.
 * @param services Composed import services sharing the application's reset and expiry lifecycle.
 * @returns Binary preparation, paged rows, validation, confirmation, status and cancellation endpoints.
 */
export function tableImportRoutes({ imports }: Services) {
  const router = Router();
  if (!imports) return router;
  const tables = imports.tables;
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.post("/", async (request, response) => {
    if (
      !request.is("text/csv") &&
      !request.is("text/markdown") &&
      !request.is("text/plain") &&
      !request.is("application/octet-stream")
    ) {
      response.status(415).json({
        detail:
          "A text/csv, text/markdown, text/plain or application/octet-stream file body is required.",
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
      prepared = await tables.prepare(input, request.query, controller.signal);
      controller.signal.throwIfAborted();
      response.status(201).json(prepared);
    } catch (error) {
      if (controller.signal.aborted) {
        if (prepared) await tables.discard(prepared.id);
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
    response.json(await tables.read(request.params.import_id));
  });
  router.get("/:import_id/rows", async (request, response) => {
    const page = z
      .strictObject({
        offset: z.coerce.number().int().min(0).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
      })
      .parse(request.query);
    response.json(await tables.rows(request.params.import_id, page));
  });
  router.post("/:import_id/validate", async (request, response) => {
    response.json(
      await tables.validate(request.params.import_id, request.body),
    );
  });
  router.post("/:import_id/confirm", async (request, response) => {
    // A lost response is recovered by status lookup or an equivalent retry of this token and mapping.
    response.json(
      inventoryResponse(
        await tables.confirm(request.params.import_id, request.body),
      ),
    );
  });
  router.delete("/:import_id", async (request, response) => {
    await tables.discard(request.params.import_id);
    response.status(204).end();
  });
  return router;
}
