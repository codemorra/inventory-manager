import { z } from "zod";
import { nameSchema } from "../validation/common.js";

// Schema for creating a new inventory.
export const inventoryCreateSchema = z.object({
  name: nameSchema,
  description: z.string().nullable().default(null),
});

// Schema for updating an existing inventory.
export const inventoryUpdateSchema = z.object({
  name: nameSchema.nullable().optional(),
  description: z.string().nullable().optional(),
});
