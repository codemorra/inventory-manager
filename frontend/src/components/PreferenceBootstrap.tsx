import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { preferenceStore } from "../preferences/store";
import { applyTheme } from "../appearance/theme";
import { applyAccent } from "../appearance/accent";

/** Gate editable application UI until persisted application preferences and inventory views are loaded. */
export function PreferenceBootstrap({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const status = useSyncExternalStore(
    preferenceStore.subscribe,
    preferenceStore.getStatus,
    preferenceStore.getStatus,
  );
  useEffect(() => {
    const disconnect = preferenceStore.connect();
    const apply = () => {
      if (!preferenceStore.isReady()) return;
      const preferences = preferenceStore.readPreferences()!;
      applyTheme(preferences.theme);
      applyAccent(preferences.accent);
      const language =
        preferences.language === "system"
          ? navigator.language.toLowerCase().startsWith("de")
            ? "de"
            : "en"
          : preferences.language;
      if (i18n.resolvedLanguage !== language)
        void i18n.changeLanguage(language);
    };
    const unsubscribe = preferenceStore.subscribe(apply);
    apply();
    void preferenceStore.initialize().catch(() => {});
    return () => {
      unsubscribe();
      disconnect();
    };
  }, [i18n]);
  if (status.phase === "ready") return children;
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-5 text-foreground">
      <div className="max-w-md rounded-lg border border-shell bg-surface p-5">
        {status.phase === "error" ? (
          <>
            <p role="alert">{t("preferences.loadFailed")}</p>
            <button
              type="button"
              className="mt-4 rounded-md bg-accent px-3 py-2 font-medium text-surface"
              onClick={() => void preferenceStore.initialize().catch(() => {})}
            >
              {t("common.actions.retry")}
            </button>
          </>
        ) : (
          <p role="status">{t("preferences.loading")}</p>
        )}
      </div>
    </main>
  );
}
