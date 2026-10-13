import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { LanguageSwitch } from "../LanguageSwitch";
import { Navigation } from "./Navigation";

// Define properties for the shared application shell.
interface AppShellProps {
  children: ReactNode;
}

/**
 * Render the responsive application chrome around routed page content.
 * @param children The routed page content.
 * @returns The shared application layout.
 */
export function AppShell({ children }: AppShellProps) {
  const { t } = useTranslation();
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);

  useEffect(() => {
    if (!isNavigationOpen) {
      return;
    }

    /**
     * Close the mobile navigation when Escape is pressed.
     * @param event The keyboard event to handle.
     */
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsNavigationOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isNavigationOpen]);

  const sidebarContent = (
    <div className="flex min-h-full flex-col">
      <div className="flex items-center gap-3 px-2">
        <span className="grid size-10 place-items-center rounded-xl bg-blue-600 text-white shadow-sm dark:bg-blue-500">
          <svg
            aria-hidden="true"
            className="size-6"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.7"
            viewBox="0 0 24 24"
          >
            <path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" />
            <path d="M4 7.5V17l8 4 8-4V7.5M12 12v9" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-semibold tracking-tight text-slate-950 dark:text-white">
            {t("app.name")}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {t("app.tagline")}
          </p>
        </div>
      </div>
      <Navigation onNavigate={() => setIsNavigationOpen(false)} />
      <div className="mt-auto rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
        <LanguageSwitch />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <a
        className="fixed left-4 top-3 z-50 -translate-y-24 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white focus:translate-y-0"
        href="#page-content"
      >
        {t("navigation.skipToContent")}
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white px-4 py-6 dark:border-slate-800 dark:bg-slate-900 lg:block">
        {sidebarContent}
      </aside>

      {isNavigationOpen && (
        <div
          aria-label={t("navigation.mobileDialog")}
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/50 lg:hidden"
          role="dialog"
        >
          <button
            aria-label={t("navigation.closeBackdrop")}
            className="absolute inset-0 cursor-default"
            onClick={() => setIsNavigationOpen(false)}
            type="button"
          />
          <aside className="relative flex h-full w-[min(20rem,88vw)] flex-col border-r border-slate-200 bg-white px-4 py-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex justify-end">
              <button
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                onClick={() => setIsNavigationOpen(false)}
                type="button"
              >
                {t("navigation.close")}
              </button>
            </div>
            <div className="mt-5 min-h-0 flex-1">{sidebarContent}</div>
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="flex min-h-16 items-center border-b border-slate-200 bg-white px-5 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-8 lg:hidden">
          <button
            aria-label={t("navigation.open")}
            className="rounded-lg border border-slate-300 p-2.5 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 lg:hidden"
            onClick={() => setIsNavigationOpen(true)}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.7"
              viewBox="0 0 24 24"
            >
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </header>

        <main
          className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:py-10"
          id="page-content"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
