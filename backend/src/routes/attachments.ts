import { Router } from "express";
import { PassThrough } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { Services } from "../services.js";
import { attachmentResponse } from "./responses.js";

/**
 * Expose staged binary upload/cancellation and explicit download, never application launching.
 * @param services The composed services with explicitly configured file storage.
 * @returns Field-scoped attachment routes; no storage means no upload endpoints.
 */
export function attachmentRoutes({ attachments }: Services) {
  const router = Router();
  if (!attachments) return router;
  const path = "/:inventory_id/fields/:field_id/attachments";
  router.post(path, async (request, response) => {
    if (!request.is("application/octet-stream"))
      throw new z.ZodError([
        {
          code: "custom",
          path: [],
          message: "Upload must use application/octet-stream.",
        },
      ]);
    let filename: string;
    try {
      filename = decodeURIComponent(request.get("X-File-Name") ?? "");
    } catch {
      throw new z.ZodError([
        {
          code: "custom",
          path: ["filename"],
          message: "Filename must be URI-encoded UTF-8.",
        },
      ]);
    }
    // Isolate the HTTP request from pipeline destruction so storage errors can return JSON.
    const input = new PassThrough();
    // Streaming may abort while directory creation is pending, before pipeline installs its listeners.
    input.on("error", () => {});
    const abort = () =>
      input.destroy(new Error("Attachment upload interrupted."));
    request.once("aborted", abort);
    request.once("error", abort);
    request.pipe(input);
    try {
      const file = await attachments.upload(
        request.params.inventory_id,
        request.params.field_id,
        {
          filename,
          media_type: request.get("X-File-Type") ?? "application/octet-stream",
        },
        input,
      );
      response.status(201).json(attachmentResponse(file));
    } finally {
      request.off("aborted", abort);
      request.off("error", abort);
      request.unpipe(input);
      input.destroy();
      if (!request.readableEnded) request.resume();
    }
  });
  router.get(`${path}/:attachment_id`, (request, response) =>
    response.json(
      attachmentResponse(
        attachments.get(
          request.params.inventory_id,
          request.params.field_id,
          request.params.attachment_id,
        ),
      ),
    ),
  );
  router.get(`${path}/:attachment_id/download`, async (request, response) => {
    const file = await attachments.download(
      request.params.inventory_id,
      request.params.field_id,
      request.params.attachment_id,
    );
    response
      .attachment(file.metadata.filename)
      .type("application/octet-stream");
    response.set({
      "Content-Length": String(file.metadata.byteSize),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    await pipeline(file.stream, response);
  });
  router.delete(`${path}/:attachment_id`, (request, response) => {
    attachments.discard(
      request.params.inventory_id,
      request.params.field_id,
      request.params.attachment_id,
    );
    response.status(204).end();
  });
  return router;
}
