import { useStoredPreference } from "./useStoredPreference";

export const largeAttachmentWarningBytes = 100 * 1024 * 1024;

/** Share the advisory file-warning preference with settings and attachment controls. */
export function useAttachmentWarnings() {
  const [value, setValue] = useStoredPreference("attachmentWarnings");
  return [value ?? "show", setValue] as const;
}
