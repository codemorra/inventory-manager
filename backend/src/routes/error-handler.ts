import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { DomainError } from "../errors.js";
import type { Logger } from "../logging.js";

/**
 * Creates an Express error handler middleware.
 * @param logger - The application's logger.
 * @returns An Express error handler function.
 */
export function errorHandler(
  logger: Pick<Logger, "error">,
): ErrorRequestHandler {
  return (error: unknown, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    // Handle domain-specific errors first
    if (error instanceof DomainError) {
      const status =
        error.code === "application_settings_unavailable" ||
        error.code === "backup_schedule_unavailable"
          ? 503
          : error.code === "attachment_preview_unavailable"
            ? 415
            : error.code === "application_data_changed" ||
                error.code === "backup_conflict" ||
                error.code === "storage_location_conflict" ||
                error.code === "application_settings_conflict" ||
                error.code === "inventory_view_conflict" ||
                error.code === "inventory_import_conflict" ||
                error.code === "inventory_export_conflict" ||
                error.code === "attachment_already_attached" ||
                error.code === "inventory_item_conflict" ||
                error.code === "inventory_template_conflict" ||
                error.code === "inventory_configuration_conflict"
              ? 409
              : error.code === "invalid_backup_archive" ||
                  error.code === "storage_location_invalid" ||
                  error.code === "invalid_inventory_archive" ||
                  error.code === "unsupported_inventory_archive_version" ||
                  error.code === "inventory_export_unavailable" ||
                  error.code === "inventory_field_options_not_supported" ||
                  error.code === "automatic_id_exhausted" ||
                  error.code === "invalid_inventory_field_configuration" ||
                  error.code === "invalid_inventory_item_value"
                ? 422
                : 404;
      response.status(status).json({
        detail: {
          code: error.code,
          message: error.message,
          ...(error.itemId === undefined ? {} : { item_id: error.itemId }),
        },
      });
      return;
    }

    // Handle Zod validation errors next
    if (error instanceof ZodError) {
      response.status(422).json({
        detail: error.issues.map((issue) => ({
          type: issue.code === "custom" ? "value_error" : issue.code,
          loc: [
            "body",
            ...issue.path.map((part) =>
              typeof part === "symbol" ? String(part) : part,
            ),
          ],
          msg: issue.message,
        })),
      });
      return;
    }

    // Handle body parser errors next
    if (error instanceof Error && "type" in error) {
      if (error.type === "entity.too.large") {
        response.status(413).json({ detail: "Request body too large." });
        return;
      }
      if (error.type === "entity.parse.failed") {
        response.status(422).json({
          detail: [
            { type: "json_invalid", loc: ["body"], msg: "Invalid JSON." },
          ],
        });
        return;
      }
    }
    logger.error("Unexpected request error", error);
    response.status(500).json({ detail: "Internal Server Error" });
  };
}
