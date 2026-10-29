import { PreferenceStatus } from "../PreferenceStatus";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { AppLogo } from "../AppLogo";

import { InventoryImportDialog } from "../InventoryImportDialog";
import { Modal } from "../Modal";
import { dataChangedEvent } from "../../services/api";
import { reloadAfterRestore } from "../../services/backups";
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
  const [configurationInventoryId, setConfigurationInventoryId] = useState<
    string | null
  >(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  // Follow system appearance changes even while settings are closed.
  useTheme();
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [dataChanged, setDataChanged] = useState(false);
  useEffect(() => {
    /**
     * Block stale editing sessions when a response identifies a replaced data generation.
     * @returns No value; the user must reload before continuing.
     */
    function changed() {
      setDataChanged(true);
    }
    window.addEventListener(dataChangedEvent, changed);
    return () => window.removeEventListener(dataChangedEvent, changed);
  }, []);
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
      <NavLink
        to="/"
        end
        title={t("navigation.goToOverview")}
        aria-label={`${t("app.name")} – ${t("navigation.goToOverview")}`}
        onClick={() => setIsNavigationOpen(false)}
        className="mx-3 mt-3 flex shrink-0 items-center gap-2 rounded-md px-2 py-2 transition hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <AppLogo />
        <div>
          <p className="whitespace-nowrap text-lg font-semibold tracking-tight text-accent">
            {t("app.name")}
          </p>
        </div>
      </NavLink>
      <Navigation
        onContext={setContextTarget}
        onNavigate={() => setIsNavigationOpen(false)}
        onImport={() => {
          setIsNavigationOpen(false);
          setIsImportOpen(true);
        }}
        onCreateGroup={() => {
          setIsNavigationOpen(false);
          setIsGroupCreateOpen(true);
        }}
      />
      <div className="mt-auto grid shrink-0 gap-1 border-t border-shell px-3 py-3">
        <NavLink
          to="/settings"
          onClick={() => setIsNavigationOpen(false)}
          className={({ isActive }) =>
            `flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-accent ${isActive ? "bg-accent-soft text-accent" : "text-muted hover:bg-control-hover hover:text-foreground"}`
          }
        >
          <svg
            aria-hidden="true"
            className="size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.47 10.14 21.90 10.61 21.90 13.39 19.47 13.86 18.60 15.97 19.99 18.02 18.02 19.99 15.97 18.60 13.86 19.47 13.39 21.90 10.61 21.90 10.14 19.47 8.03 18.60 5.98 19.99 4.01 18.02 5.40 15.97 4.53 13.86 2.10 13.39 2.10 10.61 4.53 10.14 5.40 8.03 4.01 5.98 5.98 4.01 8.03 5.40 10.14 4.53 10.61 2.10 13.39 2.10 13.86 4.53 15.97 5.40 18.02 4.01 19.99 5.98 18.60 8.03Z"
            />
            <circle cx="12" cy="12" r="3.2" />
          </svg>
          {t("settings.title")}
        </NavLink>
      </div>
    </div>
  );

  return (
    <TableEditSessionContext.Provider
      value={{
        inventoryId: editingInventoryId,
        configurationInventoryId,
        setConfigurationInventoryId,
        setInventoryId: setEditingInventoryId,
      }}
    >
      <div className="min-h-dvh bg-canvas text-foreground">
        <PreferenceStatus />
        <InventoryImportDialog
          open={isImportOpen}
          onClose={() => setIsImportOpen(false)}
        />
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
      {dataChanged && (
        <Modal
          title={t("backups.dataChangedTitle")}
          size="small"
          closeDisabled
          onClose={() => {}}
        >
          <p className="text-sm">{t("backups.dataChanged")}</p>
          <button
            type="button"
            onClick={reloadAfterRestore}
            className="mt-4 rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface enabled:hover:bg-accent-hover"
          >
            {t("backups.reloadApplication")}
          </button>
        </Modal>
      )}
    </TableEditSessionContext.Provider>
  );
}
