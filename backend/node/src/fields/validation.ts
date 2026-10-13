import { z } from "zod";
import { fieldTypes } from "../db/schema.js";
import { optionCreateSchema } from "../options/validation.js";
import { integerSchema, nameSchema } from "../validation/common.js";
import { caseFold } from "../validation/case-folding.js";

/**
 * Determines if a field type supports options.
 * @param fieldType - The type of the field.
 * @returns True if the field type supports options, false otherwise.
 */
export function supportsOptions(fieldType: string) {
  return fieldType === "select" || fieldType === "multiselect";
}

// Schema for creating a new inventory field.
export const fieldCreateSchema = z
  .object({
    name: nameSchema,
    field_type: z.enum(fieldTypes).default("text"),
    max_length: integerSchema(1, 10_000).nullable().default(null),
    options: z.array(optionCreateSchema).max(100).default([]),
  })
  .superRefine((data, context) => {
    if (data.field_type !== "text" && data.max_length !== null) {
      context.addIssue({
        code: "custom",
        message: "Only text fields can define a maximum length.",
      });
    }
    if (supportsOptions(data.field_type)) {
      if (!data.options.length) {
        context.addIssue({
          code: "custom",
          message: "Select and multiselect fields require at least one option.",
        });
      }
      const names = data.options.map((option) => caseFold(option.name));
      if (new Set(names).size !== names.length) {
        context.addIssue({
          code: "custom",
          message: "Field options must have unique names.",
        });
      }
    } else if (data.options.length) {
      context.addIssue({
        code: "custom",
        message: "Only select and multiselect fields can define options.",
      });
    }
  })
  .transform((data) => ({
    ...data,
    max_length: data.field_type === "text" ? (data.max_length ?? 255) : null,
  }));

export const fieldUpdateSchema = z.object({
  name: nameSchema.nullable().optional(),
  position: integerSchema(0).nullable().optional(),
});
