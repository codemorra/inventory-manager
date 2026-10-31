import { z } from "zod";
import { storagePath } from "../storage-paths.js";

export const directorySchema = z
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
const locationPairSchema = z.strictObject({
  dataDirectory: directorySchema,
  backupsDirectory: directorySchema,
});
export const storageLocationsSchema = z.strictObject({
  dataDirectory: directorySchema.optional(),
  backupsDirectory: directorySchema.optional(),
  relocation: z
    .strictObject({
      id: z.uuid(),
      phase: z.enum(["pending", "cleanup"]),
      source: locationPairSchema,
      target: locationPairSchema,
    })
    .optional(),
  moveFailed: z.boolean().optional(),
});
export type StorageLocations = z.output<typeof storageLocationsSchema>;

export const preferenceSchema = z.strictObject({
  language: z.enum(["system", "de", "en"]),
  theme: z.enum(["system", "light", "dark"]),
  accent: z.enum([
    "turquoise",
    "cyan",
    "blue",
    "purple",
    "orange",
    "green",
    "slate",
  ]),
  attachmentWarnings: z.enum(["show", "hide"]),
});
export const defaultPreferences: z.output<typeof preferenceSchema> = {
  language: "system",
  theme: "system",
  accent: "turquoise",
  attachmentWarnings: "show",
};
export const revisionSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
export const backupPolicySchema = z.strictObject({
  frequency: z.enum(["disabled", "daily", "weekly"]),
  retention: z.number().int().min(1).max(1000),
});
export type BackupPolicy = z.output<typeof backupPolicySchema>;
export const defaultBackupPolicy: BackupPolicy = {
  frequency: "disabled",
  retention: 10,
};
export const backupPolicyUpdateSchema = z.strictObject({
  expected_revision: revisionSchema,
  policy: backupPolicySchema,
});
export const settingsDocumentSchema = z.strictObject({
  version: z.literal(1),
  revision: revisionSchema.default(0),
  preferences: preferenceSchema
    .partial()
    .extend({
      // Normalize the previous name and retired accents when reading; public writes remain strict.
      accent: z
        .preprocess(
          (value) =>
            value === "brand"
              ? "turquoise"
              : value === "rose" || value === "teal"
                ? defaultPreferences.accent
                : value,
          preferenceSchema.shape.accent,
        )
        .optional(),
    })
    .default({}),
  storage: storageLocationsSchema.optional(),
  backups: backupPolicySchema.optional(),
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
