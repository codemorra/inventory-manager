import { apiBaseUrl, request } from "./api";
import type {
  CreatedBackup,
  StoredBackup,
  RestorePreview,
  RestoreReceipt,
  RestoreStatus,
} from "../types/backup";

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

/**
 * Prepare a checked restoration from a stored archive or a streamed local File.
 * @param source The generated stored filename or original selected File.
 * @param signal Optional cancellation before confirmation.
 * @returns A fully validated, expiring preview of the selected backup.
 * @throws {ApiError} When the source archive is unavailable or invalid.
 * @throws {Error} When copying, cancellation or transport fails.
 */
export function prepareBackupRestore(
  source: string | File,
  signal?: AbortSignal,
): Promise<RestorePreview> {
  return request("/backup-restores", {
    method: "POST",
    ...(typeof source === "string"
      ? { body: JSON.stringify({ filename: source }) }
      : { headers: { "Content-Type": "application/zip" }, body: source }),
    ...(signal ? { signal } : {}),
  });
}

/**
 * Explicitly confirm the same checked selection, preserving its receipt for response recovery.
 * @param id The validated preview identity shown in the confirmation.
 * @returns The completed restoration and its safety backup filename.
 * @throws {ApiError} When safety backup creation or restoration fails.
 * @throws {Error} When the result is uncertain; query status before another attempt.
 */
export function confirmBackupRestore(id: string): Promise<RestoreReceipt> {
  return request(`/backup-restores/${encodeURIComponent(id)}/confirm`, {
    method: "POST",
  });
}

/**
 * Recover the authoritative outcome of the original confirmation.
 * @param id The original restore selection identity.
 * @returns The preview, ongoing operation or durable completion receipt.
 * @throws {Error} When the result cannot be retrieved.
 */
export function readBackupRestore(id: string): Promise<RestoreStatus> {
  return request(`/backup-restores/${encodeURIComponent(id)}`);
}

/**
 * Discard a copied archive before restoration starts.
 * @param id The unused preview identity.
 * @returns Completion after unused staging has been removed.
 * @throws {Error} When the selection is active or cannot be discarded.
 */
export function discardBackupRestore(id: string): Promise<void> {
  return request(`/backup-restores/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/**
 * Reload the application at its overview after replacing the underlying data.
 * @returns No value; navigation creates fresh caches and editing sessions.
 */
export function reloadAfterRestore(): void {
  window.location.assign("/");
}
