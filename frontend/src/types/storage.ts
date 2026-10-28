export interface StorageDirectories {
  dataDirectory: string;
  backupsDirectory: string;
}
export interface StorageLocationState {
  revision: number;
  paths: StorageDirectories & {
    databasePath: string;
    settingsPath: string;
    logsDirectory: string;
    tempDirectory: string;
  };
  defaults: StorageDirectories;
  dataMovable: boolean;
  pending: StorageDirectories | null;
  cleanupPending: boolean;
  moveFailed: boolean;
}
