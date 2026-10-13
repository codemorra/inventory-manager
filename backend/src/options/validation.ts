import { z } from "zod";
import { nameSchema } from "../validation/common.js";

// Schema for creating a new inventory field option.
export const optionCreateSchema = z.object({ name: nameSchema });

// Schema for updating an existing inventory field option.
export const optionUpdateSchema = z.object({
  name: nameSchema.nullable().optional(),
});
