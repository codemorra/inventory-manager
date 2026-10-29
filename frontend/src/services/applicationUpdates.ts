import { request } from "./api";
import type { ApplicationUpdate } from "../types/applicationUpdate";

/**
 * Request one manual release check from the backend without caching the result.
 * @param signal Cancellation signal for a dismissed Settings dialog.
 * @returns The release state or a recoverable GitHub failure status.
 * @throws On a local backend transport or HTTP error.
 */
export function checkForUpdates(
  signal: AbortSignal,
): Promise<ApplicationUpdate> {
  return request("/application-update", { signal, cache: "no-store" });
}
