import { z } from "zod";
import { nameSchema } from "../validation/common.js";

// Schema for creating a new inventory.
export const inventoryCreateSchema = z.object({
  name: nameSchema,
  description: z.string().nullable().default(null),
  group_id: z.string().min(1).nullable().optional(),
});

// Schema for updating an existing inventory.
export const inventoryUpdateSchema = z.object({
  name: nameSchema.nullable().optional(),
  description: z.string().nullable().optional(),
  group_id: z.string().min(1).nullable().optional(),
});
