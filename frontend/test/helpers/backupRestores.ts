import type {
  RestorePreview,
  RestoreReceipt,
  StoredBackup,
} from "../../src/types/backup";

export const restoreBackup: StoredBackup = {
  filename: "backup.zip",
  byte_size: 2048,
  metadata: {
    id: "backup-id",
    kind: "manual",
    created_at: "2026-10-28T11:00:00.000Z",
  },
};
export const restorePreview: RestorePreview = {
  id: "restore-id",
  status: "ready",
  backup: restoreBackup.metadata!,
  counts: { inventories: 2, items: 5, attachments: 3 },
  attachment_bytes: 1024,
  expires_at: "2099-01-01T00:00:00.000Z",
  receipt: null,
};
export const restoreReceipt: RestoreReceipt = {
  id: "restore-id",
  backup_id: "backup-id",
  safety_backup: "safety.zip",
  completed_at: "2026-10-28T12:00:00.000Z",
};
