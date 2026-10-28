import { z } from "zod";
import { DomainError } from "../errors.js";

const file = z.strictObject({
  path: z.string().regex(/^(inventory\.db|attachments\/[0-9a-f-]{36}\.blob)$/),
  byte_size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Data backups contain a complete database snapshot and its managed attachment files. */
export const backupManifestSchema = z
  .strictObject({
    format: z.literal("inventory-manager-backup"),
    version: z.literal(1),
    id: z.uuid(),
    created_at: z.iso.datetime(),
    kind: z.enum(["manual", "automatic", "pre-restore"]),
    files: z.array(file),
  })
  .superRefine(
    /**
     * Check file uniqueness, the required snapshot and the combined declared size.
     * @param manifest Structurally validated backup metadata.
     * @param context The collector for manifest validation issues.
     * @returns No value; failures are recorded in the validation context.
     */ (manifest, context) => {
      const paths = new Set(manifest.files.map((entry) => entry.path));
      if (
        paths.size !== manifest.files.length ||
        !paths.has("inventory.db") ||
        !Number.isSafeInteger(
          manifest.files.reduce((sum, entry) => sum + entry.byte_size, 0),
        )
      )
        context.addIssue({
          code: "custom",
          message:
            "Backup files must be unique and include the database within a safe total size.",
        });
    },
  );

export type BackupManifest = z.output<typeof backupManifestSchema>;
export type BackupFile = BackupManifest["files"][number];

/**
 * Create a stable validation failure without leaking private filesystem paths.
 * @param message A user-facing explanation of the failed backup check.
 * @returns A domain error with the invalid_backup_archive code for the caller to throw.
 */
export function invalidBackup(message: string) {
  return new DomainError("invalid_backup_archive", message);
}
