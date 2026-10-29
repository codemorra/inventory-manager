import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { APP_VERSION } from "../generated/app-version";
import { checkForUpdates } from "../services/applicationUpdates";
import type { ApplicationUpdate } from "../types/applicationUpdate";

/**
 * Display the build version and an explicitly requested update-check result.
 * @returns The Settings update controls; opening Settings performs no network check.
 */
export function UpdateSettings() {
  const { t } = useTranslation();
  const [result, setResult] = useState<ApplicationUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  /**
   * Start one check, ignoring cancelled responses after the dialog is dismissed.
   * @returns Completion after updating the visible result when still mounted.
   */
  async function check() {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setChecking(true);
    setResult(null);
    try {
      const update = await checkForUpdates(abort.signal);
      if (!abort.signal.aborted) setResult(update);
    } catch {
      if (!abort.signal.aborted) {
        setResult({ status: "failed", current_version: APP_VERSION });
      }
    } finally {
      if (!abort.signal.aborted) {
        controller.current = null;
        setChecking(false);
      }
    }
  }

  return (
    <section
      aria-label={t("updates.title")}
      aria-busy={checking}
      className="mt-5 border-t border-shell pt-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-heading">
          {t("updates.version", { version: APP_VERSION })}
        </p>
        <button
          type="button"
          disabled={checking}
          onClick={() => void check()}
          className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover enabled:hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
        >
          {t("updates.check")}
        </button>
      </div>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="mt-2 min-h-10 text-sm text-muted sm:min-h-5"
      >
        {checking
          ? t("updates.checking")
          : result
            ? t(`updates.${result.status}`, {
                version:
                  "latest_version" in result ? result.latest_version : "",
              })
            : ""}
      </p>
      {result?.status === "available" && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
          <a
            href={result.release_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t("updates.openRelease")}
          </a>
          <a
            href="https://github.com/codemorra/inventory-manager#updates"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t("updates.instructions")}
          </a>
        </div>
      )}
    </section>
  );
}
