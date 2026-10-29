import { z } from "zod";
import { APP_VERSION } from "../generated/app-version.js";

const repository = "codemorra/inventory-manager";
const apiUrl = `https://api.github.com/repos/${repository}`;
// A real end-of-input assertion also rejects a trailing newline.
const releaseSchema = z.object({
  tag_name: z.string().regex(/^v[0-9]+\.[0-9]+\.[0-9]+(?![\s\S])/),
  draft: z.literal(false),
  prerelease: z.literal(false),
});

export type UpdateCheck = { current_version: string } & (
  | {
      status: "available" | "current";
      latest_version: string;
      release_url: string;
    }
  | { status: "no_release" | "failed" | "rate_limited" }
);

/**
 * Parse exactly three numeric version components without losing integer precision.
 * @param version An application version without a tag prefix.
 * @returns Major, minor and patch numbers.
 * @throws If the version is not in X.Y.Z format.
 */
function versionParts(version: string): bigint[] {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?![\s\S])/.test(version)) {
    throw new Error("Unsupported application version.");
  }
  return version.split(".").map((part) => BigInt(part));
}

/**
 * Compare numeric version components, including multi-digit minor and patch values.
 * @param latest The published version without its v prefix.
 * @param current The installed application version.
 * @returns Whether the published version is strictly newer.
 * @throws If either version is not in X.Y.Z format.
 */
function isNewer(latest: string, current: string): boolean {
  const installed = versionParts(current);
  const published = versionParts(latest);
  for (let index = 0; index < 3; index++) {
    if (published[index] !== installed[index]) {
      return published[index]! > installed[index]!;
    }
  }
  return false;
}

/**
 * Determine GitHub's required pause after a rate-limit response.
 * @param response The GitHub response and rate-limit headers.
 * @returns A retry timestamp, or null when the response is not rate limited.
 */
function retryTime(response: Response): number | null {
  if (
    response.status !== 429 &&
    !(
      response.status === 403 &&
      (response.headers.get("x-ratelimit-remaining") === "0" ||
        response.headers.has("retry-after"))
    )
  ) {
    return null;
  }
  const now = Date.now();
  const retry = response.headers.get("retry-after");
  const reset = response.headers.get("x-ratelimit-reset");
  const seconds = retry !== null ? Number(retry) : NaN;
  const retryAt = Number.isFinite(seconds)
    ? now + Math.max(0, seconds) * 1_000
    : retry !== null
      ? Date.parse(retry)
      : NaN;
  const resetAt = reset !== null ? Number(reset) * 1_000 : NaN;
  const times = [retryAt, resetAt].filter(Number.isFinite);
  return times.length ? Math.max(now, ...times) : now + 60_000;
}

/**
 * Create an on-demand, unauthenticated checker for the fixed public repository.
 * Concurrent calls share one check; GitHub's retry deadlines are kept only in memory.
 * @param request The HTTP transport, replaceable for isolated tests.
 * @param currentVersion The application version captured at build time.
 * @returns A check function that reports release state without modifying application data.
 */
export function createUpdateChecker(
  request: typeof fetch = fetch,
  currentVersion = APP_VERSION,
): () => Promise<UpdateCheck> {
  let pending: Promise<UpdateCheck> | undefined;
  let blockedUntil = 0;

  /**
   * Query GitHub with a shared deadline and retain any rate-limit deadline.
   * @param path A fixed path below the project's GitHub API URL.
   * @param signal The deadline covering the complete check.
   * @returns The GitHub response; the caller consumes or cancels its body.
   * @throws On transport failure or timeout.
   */
  async function github(path: string, signal: AbortSignal): Promise<Response> {
    const response = await request(`${apiUrl}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `InventoryManager/${currentVersion}`,
        "X-GitHub-Api-Version": "2026-03-10",
      },
      signal,
      redirect: "error",
      cache: "no-store",
    });
    const retry = retryTime(response);
    if (retry !== null) blockedUntil = retry;
    return response;
  }

  /**
   * Complete one release check within seven seconds, including response-body reads.
   * @returns A validated check result or a recoverable failure status.
   */
  async function run(): Promise<UpdateCheck> {
    const base = { current_version: currentVersion };
    if (Date.now() < blockedUntil) return { ...base, status: "rate_limited" };
    let response: Response | undefined;
    try {
      versionParts(currentVersion);
      const signal = AbortSignal.timeout(7_000);
      response = await github("/releases/latest", signal);
      if (response.status === 404) {
        await response.body?.cancel();
        // A private, renamed or missing repository can also return 404.
        // Confirm public repository availability before reporting that no release exists.
        response = await github("", signal);
        if (response.ok) return { ...base, status: "no_release" };
      } else if (response.ok) {
        const release = releaseSchema.parse(await response.json());
        const version = release.tag_name.slice(1);
        return {
          ...base,
          status: isNewer(version, currentVersion) ? "available" : "current",
          latest_version: version,
          // Construct a project-owned link rather than trusting a URL in an API response.
          release_url: `https://github.com/${repository}/releases/tag/${release.tag_name}`,
        };
      }
      return {
        ...base,
        status: retryTime(response) !== null ? "rate_limited" : "failed",
      };
    } catch {
      return { ...base, status: "failed" };
    } finally {
      if (response && !response.bodyUsed) {
        await response.body?.cancel().catch(() => {});
      }
    }
  }

  return () => {
    pending ??= run().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
