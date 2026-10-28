import { request } from "./api";
import type { BackupPolicy, BackupScheduleState } from "../types/backup";

/**
 * Read automatic backup policy and its latest success/failure status.
 * @param signal Optional cancellation when the settings section is dismissed.
 * @returns The current policy, configuration revision and operational status.
 * @throws {Error} When status cannot be retrieved or the request is canceled.
 */
export function getBackupSchedule(
  signal?: AbortSignal,
): Promise<BackupScheduleState> {
  return request("/backups/schedule", signal ? { signal } : {});
}

/**
 * Persist the user's complete automatic backup policy at the captured configuration revision.
 * @param revision The explicitly checked settings revision.
 * @param policy The daily/weekly frequency and automatic retention count.
 * @returns The accepted configuration and latest operational status.
 * @throws {Error} When validation, conflict checks or persistence fail.
 */
export function updateBackupSchedule(
  revision: number,
  policy: BackupPolicy,
): Promise<BackupScheduleState> {
  return request("/backups/schedule", {
    method: "PUT",
    body: JSON.stringify({ expected_revision: revision, policy }),
  });
}
