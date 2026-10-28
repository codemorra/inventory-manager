import { z } from "zod";
import { storagePath } from "../storage-paths.js";

const directorySchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => {
    try {
      storagePath(value);
      return true;
    } catch {
      return false;
    }
  }, "An absolute storage directory is required.");
export const storageLocationsSchema = z.strictObject({
  dataDirectory: directorySchema.optional(),
  backupsDirectory: directorySchema.optional(),
});

export const preferenceSchema = z.strictObject({
  language: z.enum(["system", "de", "en"]),
  theme: z.enum(["system", "light", "dark"]),
  accent: z.enum(["teal", "blue", "purple", "orange"]),
  attachmentWarnings: z.enum(["show", "hide"]),
});
export const defaultPreferences: z.output<typeof preferenceSchema> = {
  language: "system",
  theme: "system",
  accent: "teal",
  attachmentWarnings: "show",
};
export const revisionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
export const settingsDocumentSchema = z.strictObject({
  version: z.literal(1),
  revision: revisionSchema.default(0),
  preferences: preferenceSchema.partial().default({}),
  storage: storageLocationsSchema.optional(),
});
export type SettingsDocument = z.output<typeof settingsDocumentSchema>;
export const settingsUpdateSchema = z.strictObject({
  expected_revision: revisionSchema,
  preferences: preferenceSchema
    .partial()
    .refine(
      (value) => Object.keys(value).length > 0,
      "At least one preference is required.",
    ),
});
