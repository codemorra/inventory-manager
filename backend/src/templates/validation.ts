import { z } from "zod";
import { fieldTypes } from "../db/schema.js";
import { supportsOptions } from "../fields/validation.js";
import { inventoryCreateSchema } from "../inventories/validation.js";
import { nameSchema } from "../validation/common.js";

// Snapshots may contain empty or repeated options after ordinary inventory option edits.
// Unlike initial field creation, they must preserve that existing configuration exactly.
export const templateFieldSchema = z
  .strictObject({
    name: nameSchema,
    field_type: z.enum(fieldTypes),
    max_length: z.number().int().min(1).max(1_000).nullable().default(null),
    is_required: z.boolean().default(false),
    is_sortable: z.boolean().default(true),
    reuse_deleted_ids: z.boolean().default(false),
    options: z.array(z.strictObject({ name: nameSchema })).default([]),
  })
  .superRefine((field, context) => {
    if (field.field_type !== "text" && field.max_length !== null)
      context.addIssue({
        code: "custom",
        message: "Only text fields can define a maximum length.",
      });
    if (field.field_type !== "id" && field.reuse_deleted_ids)
      context.addIssue({
        code: "custom",
        message: "Only ID fields can reuse deleted numbers.",
      });
    if (!supportsOptions(field.field_type) && field.options.length)
      context.addIssue({
        code: "custom",
        message: "Only select and multiselect fields can define options.",
      });
  })
  .transform((field) => ({
    ...field,
    max_length: field.field_type === "text" ? (field.max_length ?? 255) : null,
  }));

export type TemplateField = z.output<typeof templateFieldSchema>;

// Template and source revisions are strict JSON numbers, matching existing editor contracts.
const revisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const metadata = {
  name: nameSchema,
  description: z.string().nullable().default(null),
};

// A new blueprint is either explicitly defined or captured from one coherent inventory revision.
export const templateCreateSchema = z.union([
  z.strictObject({ ...metadata, fields: z.array(templateFieldSchema) }),
  z.strictObject({
    ...metadata,
    source_inventory_id: z.string().min(1),
    expected_configuration_revision: revisionSchema,
  }),
]);

// Fields are a complete ordered replacement; omission preserves the stored structure.
export const templateUpdateSchema = z.strictObject({
  expected_revision: revisionSchema,
  name: nameSchema.optional(),
  description: z.string().nullable().optional(),
  fields: z.array(templateFieldSchema).optional(),
});

export const templateRevisionSchema = z.strictObject({
  expected_revision: revisionSchema,
});
export const templateInstantiateSchema = inventoryCreateSchema
  .extend({
    expected_revision: revisionSchema,
    // Positions belong to the captured template revision, not to persisted field identities.
    field_indexes: z
      .array(z.number().int().min(0).max(Number.MAX_SAFE_INTEGER))
      .refine(
        (indexes) => new Set(indexes).size === indexes.length,
        "Field indexes must be unique.",
      )
      .optional(),
  })
  .strict();
