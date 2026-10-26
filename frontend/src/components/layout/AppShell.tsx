import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsDialog } from "../SettingsDialog";
import { GroupCreateDialog } from "../GroupCreateDialog";
import { useTheme } from "../../hooks/useTheme";
import { Navigation } from "./Navigation";
import { TableEditSessionContext } from "../tableEditSession";
import {
  SidebarContextActions,
  type SidebarContextTarget,
} from "../SidebarContextActions";

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
  const [editingInventoryId, setEditingInventoryId] = useState<string | null>(
    null,
  );
  // Follow system appearance changes even while settings are closed.
  useTheme();
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isGroupCreateOpen, setIsGroupCreateOpen] = useState(false);
  const [contextTarget, setContextTarget] =
    useState<SidebarContextTarget | null>(null);

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-5 pb-1 pt-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-surface">
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
          <p className="text-sm font-semibold tracking-tight text-heading">
            {t("app.name")}
          </p>
          <p className="text-xs text-muted">{t("app.tagline")}</p>
        </div>
      </div>
      <Navigation
        onContext={setContextTarget}
        onNavigate={() => setIsNavigationOpen(false)}
        onCreateGroup={() => {
          setIsNavigationOpen(false);
          setIsGroupCreateOpen(true);
        }}
      />
      <div className="mt-auto grid shrink-0 gap-3 border-t border-shell bg-surface-muted p-4 shadow-[0_-2px_6px_rgb(0_0_0/0.06)]">
        <button
          className="flex items-center gap-2 rounded-md border border-shell bg-surface px-3 py-2 text-sm font-medium transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => {
            setIsNavigationOpen(false);
            setIsSettingsOpen(true);
          }}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="size-4 text-accent"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            viewBox="0 0 24 24"
          >
            <path d="M4 6h16M4 12h16M4 18h16" />
            <path d="M8 3v6m8 0v6M10 15v6" />
          </svg>
          {t("settings.title")}
        </button>
      </div>
    </div>
  );

  return (
    <TableEditSessionContext.Provider
      value={{
        inventoryId: editingInventoryId,
        setInventoryId: setEditingInventoryId,
      }}
    >
      <div className="min-h-dvh bg-canvas text-foreground">
        {contextTarget && (
          <SidebarContextActions
            key={`${contextTarget.kind}-${contextTarget.entry.id}-${contextTarget.x}-${contextTarget.y}`}
            target={contextTarget}
            onClose={() => setContextTarget(null)}
            onOpenDialog={() => setIsNavigationOpen(false)}
          />
        )}
        {isGroupCreateOpen && (
          <GroupCreateDialog onClose={() => setIsGroupCreateOpen(false)} />
        )}
        {isSettingsOpen && (
          <SettingsDialog onClose={() => setIsSettingsOpen(false)} />
        )}
        <a
          className="fixed left-4 top-3 z-50 -translate-y-24 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-surface focus:translate-y-0"
          href="#page-content"
        >
          {t("navigation.skipToContent")}
        </a>

        <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-shell bg-chrome lg:block">
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
            <aside className="relative flex h-full w-[min(20rem,88vw)] flex-col border-r border-shell bg-chrome shadow-raised">
              <div className="flex shrink-0 justify-end px-4 pt-4">
                <button
                  className="rounded-lg border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover enabled:hover:border-accent/50"
                  onClick={() => setIsNavigationOpen(false)}
                  type="button"
                >
                  {t("navigation.close")}
                </button>
              </div>
              <div className="min-h-0 flex-1">{sidebarContent}</div>
            </aside>
          </div>
        )}

        <div className="lg:pl-64">
          <header className="flex min-h-14 items-center border-b border-shell bg-surface px-4 py-2 sm:px-6 lg:hidden">
            <button
              aria-label={t("navigation.open")}
              className="rounded-lg border border-shell p-2.5 enabled:hover:bg-control-hover enabled:hover:border-accent/50 lg:hidden"
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
            className="min-w-0 w-full px-4 py-6 sm:px-6 lg:py-8"
            id="page-content"
            tabIndex={-1}
          >
            {children}
          </main>
        </div>
      </div>
    </TableEditSessionContext.Provider>
  );
}
