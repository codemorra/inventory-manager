import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { preferenceStore } from "../preferences/store";

/** Keep failed optimistic preference changes visible until an explicit retry or reload resolves them. */
export function PreferenceStatus() {
  const { t } = useTranslation();
  const status = useSyncExternalStore(
    preferenceStore.subscribe,
    preferenceStore.getStatus,
    preferenceStore.getStatus,
  );
  if (!status.failed && !status.refreshFailed) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-70 max-h-[40dvh] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-danger/40 bg-surface p-4 text-sm text-foreground shadow-raised sm:max-w-md"
    >
      <p>
        {t(
          status.conflict
            ? "preferences.conflict"
            : status.failed
              ? "preferences.saveFailed"
              : "preferences.refreshFailed",
        )}
      </p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {!status.conflict && (
          <button
            type="button"
            disabled={status.refreshing || status.saving}
            className="rounded-md border border-shell px-3 py-2 disabled:opacity-50"
            onClick={() => preferenceStore.retryFailed()}
          >
            {t("common.actions.retry")}
          </button>
        )}
        {status.failed && (
          <button
            type="button"
            disabled={status.refreshing || status.saving}
            className="rounded-md bg-accent px-3 py-2 font-medium text-surface disabled:opacity-50"
            onClick={() => void preferenceStore.reloadFailed()}
          >
            {t("preferences.reload")}
          </button>
        )}
      </div>
    </div>
  );
}
