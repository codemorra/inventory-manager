import type { ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { Router } from "express";
import { z } from "zod";
import type { Services } from "../services.js";

/**
 * Prepare immutable restore previews and expose explicit confirmation and status recovery.
 * @param services Services with private restore staging.
 * @param confirm The runtime operation coordinating durable data replacement.
 * @returns Preview, status, cancellation and confirmation routes.
 */
export function restoreRoutes(
  { restores }: Services,
  confirm?: (id: string, response: ServerResponse) => Promise<unknown>,
) {
  const router = Router();
  if (!restores) return router;
  router.use((_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  router.post("/", async (request, response) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.once("aborted", abort);
    request.once("error", abort);
    response.once("close", abort);
    let prepared: { id: string } | undefined;
    let input: PassThrough | undefined;
    try {
      if (request.is("application/json")) {
        const data = z
          .strictObject({ filename: z.string() })
          .parse(request.body);
        prepared = await restores.prepareStored(
          data.filename,
          controller.signal,
        );
      } else if (
        request.is("application/zip") ||
        request.is("application/octet-stream")
      ) {
        input = new PassThrough();
        input.on("error", () => {});
        const fail = () =>
          input?.destroy(new Error("Restore upload interrupted."));
        controller.signal.addEventListener("abort", fail, { once: true });
        request.pipe(input);
        prepared = await restores.prepare(input, controller.signal);
      } else {
        response.status(415).json({
          detail:
            "Select a stored backup or upload an application/zip archive.",
        });
        return;
      }
      controller.signal.throwIfAborted();
      response.status(201).json(prepared);
    } catch (error) {
      if (controller.signal.aborted) {
        if (prepared) await restores.discard(prepared.id);
      } else throw error;
    } finally {
      request.off("aborted", abort);
      request.off("error", abort);
      response.off("close", abort);
      if (input) {
        request.unpipe(input);
        input.destroy();
        if (!request.readableEnded) request.resume();
      }
    }
  });
  router.get("/:id", async (request, response) => {
    response.json(await restores.read(z.uuid().parse(request.params.id)));
  });
  router.delete("/:id", async (request, response) => {
    await restores.discard(z.uuid().parse(request.params.id));
    response.status(204).end();
  });
  if (confirm)
    router.post("/:id/confirm", async (request, response) => {
      response.json(await confirm(z.uuid().parse(request.params.id), response));
    });
  return router;
}
