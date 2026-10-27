import { useStoredPreference } from "./useStoredPreference";

export const largeAttachmentWarningBytes = 100 * 1024 * 1024;
export const attachmentWarningStorageKey =
  "inventory-manager-large-attachment-warning";

// Unknown/missing preferences show the warning; the threshold is advisory and never blocks uploads.
function readWarning(): "show" | "hide" {
  try {
    return localStorage.getItem(attachmentWarningStorageKey) === "hide"
      ? "hide"
      : "show";
  } catch {
    return "show";
  }
}

/** Share remembered warning dismissal with Settings and other open controls/tabs. */
export function useAttachmentWarnings() {
  return useStoredPreference(attachmentWarningStorageKey, readWarning);
}
