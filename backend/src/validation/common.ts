import { z } from "zod";

// Regular expression for matching leading and trailing whitespace characters.
const nameWhitespace =
  // eslint-disable-next-line no-control-regex -- These controls intentionally count as whitespace.
  /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu;

// Schema for validating names with whitespace control and length constraints.
export const nameSchema = z
  .string()
  .superRefine((value, context) => {
    if (Array.from(value).length > 255) {
      context.addIssue({
        code: "custom",
        message: "Name must contain at most 255 characters.",
      });
    }
  })
  .transform((value) => value.replace(nameWhitespace, ""))
  .refine((value) => value.length > 0, "Name must not be empty.");

/**
 * Creates a Zod schema for validating integers within a specified range.
 * @param minimum - The minimum allowed value.
 * @param maximum - The maximum allowed value (optional).
 * @returns A Zod schema for the integer.
 */
export function integerSchema(minimum: number, maximum?: number) {
  let schema = z.number().int().min(minimum);
  if (maximum !== undefined) schema = schema.max(maximum);
  return z.preprocess((value) => {
    if (typeof value === "boolean") return Number(value);
    if (typeof value === "string") {
      const candidate = value.trim();
      if (/^[+-]?\d(?:_?\d)*(?:\.0+)?$/.test(candidate)) {
        return Number(candidate.replaceAll("_", ""));
      }
    }
    return value;
  }, schema);
}
