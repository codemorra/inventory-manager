export interface BackupMetadata {
  id: string;
  created_at: string;
  kind: "manual" | "automatic" | "pre-restore";
}

export interface StoredBackup {
  filename: string;
  byte_size: number;
  metadata: BackupMetadata | null;
}

export interface CreatedBackup extends BackupMetadata {
  filename: string;
  byte_size: number;
}

export interface RestoreReceipt {
  id: string;
  backup_id: string;
  safety_backup: string;
  completed_at: string;
}

export interface RestorePreview {
  id: string;
  status: "ready" | "restoring";
  backup: BackupMetadata;
  counts: { inventories: number; items: number; attachments: number };
  attachment_bytes: number;
  expires_at: string;
  receipt: null;
}

export type RestoreStatus =
  RestorePreview | { id: string; status: "completed"; receipt: RestoreReceipt };
