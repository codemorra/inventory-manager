import { z } from "zod";
import type { inventoryFields, inventoryFieldOptions } from "../db/schema.js";
import { DomainError } from "../errors.js";
import { urlValueSchema } from "./url.js";
import {
  InvalidTemporalValueError,
  validateTemporalValue,
} from "./temporal.js";

const valueInputSchema = z.object({
  field_id: z.string(),
  value: z
    .unknown()
    .refine(
      (value): boolean => value !== undefined,
      "Field value is required.",
    ),
});

// Schema for inventory item input, including validation for individual field values.
export const itemInputSchema = z.object({
  values: z.array(valueInputSchema).default([]),
});

// Require an exact saved revision for replacement and deletion; never coerce strings or booleans.
export const itemRevisionSchema = z.object({
  expected_revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
});
export const itemUpdateSchema = itemInputSchema.extend(
  itemRevisionSchema.shape,
);
export type ItemUpdateInput = z.infer<typeof itemUpdateSchema>;

// Require explicit replacements and unambiguous row IDs before entering a transaction.
export const itemBatchUpdateSchema = z
  .strictObject({
    expected_configuration_revision: itemRevisionSchema.shape.expected_revision,
    items: z
      .array(
        z.strictObject({
          item_id: z.string().min(1),
          expected_revision: itemRevisionSchema.shape.expected_revision,
          values: z.array(valueInputSchema.strict()),
        }),
      )
      .min(1),
  })
  .superRefine((data, context) => {
    const seen = new Set<string>();
    for (const [index, item] of data.items.entries()) {
      if (seen.has(item.item_id))
        context.addIssue({
          code: "custom",
          path: ["items", index, "item_id"],
          message: "An item can only be replaced once per save.",
        });
      seen.add(item.item_id);
    }
  });
export type ValueInput = z.infer<typeof valueInputSchema>;
type Field = typeof inventoryFields.$inferSelect;
type Option = typeof inventoryFieldOptions.$inferSelect;

function invalidValue(): never {
  throw new DomainError(
    "invalid_inventory_item_value",
    "Inventory item values are invalid.",
  );
}

/**
 * Validates inventory item values against the provided field definitions and options.
 * Ensures that each value conforms to its field type and constraints.
 * @param values The inventory item values to validate.
 * @param fields The field definitions to validate against.
 * @param options The field options to validate against.
 * @throws {DomainError} If any of the values are invalid.
 */
export function validateValues(
  values: ValueInput[],
  fields: Field[],
  options: Option[],
): void {
  const definitions = new Map(fields.map((field) => [field.id, field]));
  const optionIds = new Map<string, Set<string>>();
  for (const option of options) {
    const ids = optionIds.get(option.fieldId) ?? new Set<string>();
    ids.add(option.id);
    optionIds.set(option.fieldId, ids);
  }
  const seen = new Set<string>();
  // Unknown/duplicate field IDs take precedence over individual value validation in the reference.
  for (const input of values) {
    if (seen.has(input.field_id) || !definitions.has(input.field_id))
      invalidValue();
    seen.add(input.field_id);
  }
  // Validate required fields are present
  const submitted = new Map(
    values.map((input) => [input.field_id, input.value]),
  );
  for (const field of fields) {
    if (!field.isRequired || field.fieldType === "id") continue;
    const value = submitted.get(field.id);
    if (
      value === undefined ||
      value === null ||
      (typeof value === "string" && !value.trim()) ||
      (Array.isArray(value) && value.length === 0)
    )
      invalidValue();
  }
  for (const { field_id, value } of values) {
    const field = definitions.get(field_id)!;
    switch (field.fieldType) {
      case "id":
        // Automatic numbers cannot be supplied, cleared, or overwritten by clients.
        return invalidValue();
      case "text":
        if (
          typeof value !== "string" ||
          Array.from(value).length > (field.maxLength || 255)
        )
          invalidValue();
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value))
          invalidValue();
        break;
      case "boolean":
      case "checkbox":
        if (typeof value !== "boolean") invalidValue();
        break;
      case "duration":
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          !Number.isSafeInteger(value) ||
          value < 0
        )
          invalidValue();
        break;
      case "url":
        if (!urlValueSchema.safeParse(value).success) invalidValue();
        break;
      case "date":
      case "time":
      case "datetime":
        if (typeof value !== "string") invalidValue();
        try {
          validateTemporalValue(field.fieldType, value);
        } catch (error) {
          if (error instanceof InvalidTemporalValueError) invalidValue();
          throw error;
        }
        break;
      case "select":
        if (typeof value !== "string" || !optionIds.get(field_id)?.has(value))
          invalidValue();
        break;
      case "multiselect":
        if (
          !Array.isArray(value) ||
          !value.length ||
          !value.every(
            (id) => typeof id === "string" && optionIds.get(field_id)?.has(id),
          )
        )
          invalidValue();
        break;
      case "attachment":
        if (
          !Array.isArray(value) ||
          !value.length ||
          !value.every((id) => typeof id === "string" && id.length > 0) ||
          new Set(value).size !== value.length
        )
          invalidValue();
        break;
    }
  }
}
