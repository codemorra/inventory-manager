import { z } from "zod";
import { fieldCreateSchema, fieldUpdateSchema } from "../fields/validation.js";
import {
  optionCreateSchema,
  optionUpdateSchema,
} from "../options/validation.js";
import { inventoryUpdateSchema } from "./validation.js";

const identifier = z.string().min(1);

// New fields include their initial options; existing fields retain their type and text limit.
const fieldChangeSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    client_id: identifier.optional(),
    data: fieldCreateSchema,
  }),
  z.strictObject({
    action: z.literal("update"),
    field_id: identifier,
    data: fieldUpdateSchema.strict(),
  }),
  z.strictObject({ action: z.literal("delete"), field_id: identifier }),
]);

// Option changes target saved fields; options on unsaved fields are part of field creation.
const optionChangeSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    field_id: identifier,
    data: optionCreateSchema.strict(),
  }),
  z.strictObject({
    action: z.literal("update"),
    field_id: identifier,
    option_id: identifier,
    data: optionUpdateSchema.strict(),
  }),
  z.strictObject({
    action: z.literal("delete"),
    field_id: identifier,
    option_id: identifier,
  }),
]);

// Reject ambiguous batches before any database writes are attempted.
export const inventoryEditorSchema = z
  .strictObject({
    expected_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    inventory: inventoryUpdateSchema
      .omit({ group_id: true })
      .strict()
      .default({}),
    fields: z.array(fieldChangeSchema).max(1000).default([]),
    options: z.array(optionChangeSchema).max(1000).default([]),
    // Explicit references distinguish saved IDs from temporary draft identifiers.
    field_order: z
      .array(
        z.union([
          z.strictObject({ field_id: identifier }),
          z.strictObject({ client_id: identifier }),
        ]),
      )
      .max(1000)
      .optional(),
  })
  .superRefine((data, context) => {
    const fields = new Set<string>();
    const deletedFields = new Set<string>();
    const clientIds = new Set<string>();
    for (const [index, change] of data.fields.entries()) {
      if (change.action === "create") {
        if (change.client_id !== undefined) {
          if (clientIds.has(change.client_id))
            context.addIssue({
              code: "custom",
              path: ["fields", index, "client_id"],
              message: "A draft field identifier must be unique.",
            });
          clientIds.add(change.client_id);
        }
        continue;
      }
      if (
        data.field_order !== undefined &&
        change.action === "update" &&
        change.data.position !== undefined
      ) {
        context.addIssue({
          code: "custom",
          path: ["fields", index, "data", "position"],
          message:
            "Use field_order instead of individual positions when reordering a draft.",
        });
      }
      if (fields.has(change.field_id)) {
        context.addIssue({
          code: "custom",
          path: ["fields", index],
          message: "A field can only be changed once per save.",
        });
      }
      fields.add(change.field_id);
      if (change.action === "delete") deletedFields.add(change.field_id);
    }
    const options = new Set<string>();
    for (const [index, change] of data.options.entries()) {
      if (deletedFields.has(change.field_id)) {
        context.addIssue({
          code: "custom",
          path: ["options", index],
          message: "Options of a deleted field cannot be changed.",
        });
      }
      if (change.action === "create") continue;
      if (options.has(change.option_id)) {
        context.addIssue({
          code: "custom",
          path: ["options", index],
          message: "An option can only be changed once per save.",
        });
      }
      options.add(change.option_id);
    }
  });
