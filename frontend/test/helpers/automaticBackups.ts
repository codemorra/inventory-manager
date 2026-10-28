import type { BackupScheduleState } from "../../src/types/backup";

export const automaticSchedule: BackupScheduleState = {
  revision: 3,
  policy: { frequency: "disabled", retention: 10 },
  running: false,
  last_success: null,
  last_failure: null,
  retention_pending: false,
  next_retry_at: null,
};
