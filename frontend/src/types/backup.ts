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
