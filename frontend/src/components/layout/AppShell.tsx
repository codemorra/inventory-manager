import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { LanguageSwitch } from "../LanguageSwitch";
import { ThemeSwitch } from "../ThemeSwitch";
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
        <span className="grid size-10 place-items-center rounded-xl bg-accent text-surface shadow-soft">
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
          <p className="text-sm font-semibold tracking-tight text-foreground">
            {t("app.name")}
          </p>
          <p className="text-xs text-muted">{t("app.tagline")}</p>
        </div>
      </div>
      <Navigation onNavigate={() => setIsNavigationOpen(false)} />
      <div className="mt-auto grid gap-3 rounded-xl border border-shell bg-surface-muted p-3">
        <LanguageSwitch />
        <ThemeSwitch />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh bg-canvas bg-(image:--app-canvas-gradient) text-foreground">
      <a
        className="fixed left-4 top-3 z-50 -translate-y-24 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface focus:translate-y-0"
        href="#page-content"
      >
        {t("navigation.skipToContent")}
      </a>

      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-shell bg-surface px-4 py-6 shadow-soft lg:block">
        {sidebarContent}
      </aside>

      {isNavigationOpen && (
        <div
          aria-label={t("navigation.mobileDialog")}
          aria-modal="true"
          className="fixed inset-0 z-50 bg-black/50 lg:hidden"
          role="dialog"
        >
          <button
            aria-label={t("navigation.closeBackdrop")}
            className="absolute inset-0 cursor-default"
            onClick={() => setIsNavigationOpen(false)}
            type="button"
          />
          <aside className="relative flex h-full w-[min(20rem,88vw)] flex-col border-r border-shell bg-surface px-4 py-6 shadow-raised">
            <div className="flex justify-end">
              <button
                className="rounded-lg border border-shell px-3 py-2 text-sm font-medium hover:bg-surface-hover"
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
        <header className="flex min-h-16 items-center border-b border-shell bg-surface px-5 py-3 shadow-soft sm:px-8 lg:hidden">
          <button
            aria-label={t("navigation.open")}
            className="rounded-lg border border-shell p-2.5 hover:bg-surface-hover lg:hidden"
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
