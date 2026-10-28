import { apiBaseUrl, request } from "./api";
import type { CreatedBackup, StoredBackup } from "../types/backup";

/**
 * Load durable backup filenames and available display metadata.
 * @param signal Optional cancellation when the backup view is dismissed.
 * @returns Backups ordered newest first.
 * @throws {ApiError} When the backend rejects the request.
 * @throws {Error} When the request fails or is canceled.
 */
export function listBackups(signal?: AbortSignal): Promise<StoredBackup[]> {
  return request("/backups", signal ? { signal } : {});
}

/**
 * Create and verify a durable data backup in the configured backup directory.
 * @returns Metadata for the successfully published archive.
 * @throws {ApiError} When backup creation fails on the backend.
 * @throws {Error} When the response cannot be received; completion may require refreshing the list.
 */
export function createBackup(): Promise<CreatedBackup> {
  return request("/backups", { method: "POST" });
}

/**
 * Delete the archive explicitly selected in the confirmation dialog.
 * @param filename The generated basename of the selected backup.
 * @returns Completion after the backend confirms deletion.
 * @throws {ApiError} When the backup is unavailable, in use or cannot be deleted.
 * @throws {Error} When the response is lost; refresh the list before retrying.
 */
export function deleteBackup(filename: string): Promise<void> {
  return request(`/backups/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
}

/**
 * Hand an existing archive to the browser's native downloader.
 * @param filename The generated basename returned by the backend.
 * @returns No value; the browser owns download progress and file saving.
 */
export function downloadBackup(filename: string): void {
  const link = document.createElement("a");
  link.href = `${apiBaseUrl}/backups/${encodeURIComponent(filename)}/download`;
  link.download = filename;
  link.target = "_self";
  document.body.append(link);
  link.click();
  link.remove();
}
