import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { GeneralSettings } from "../components/GeneralSettings";
import { StorageSettings } from "../components/StorageSettings";
import { BackupSettings } from "../components/BackupSettings";
import { AboutSettings } from "../components/AboutSettings";
import { UnsavedTableChanges } from "../components/UnsavedTableChanges";

const sections = ["general", "storage", "backups", "about"] as const;
type Section = (typeof sections)[number];

/**
 * Present application preferences and management tools in persistent settings panels.
 * @returns The settings page with guarded navigation and independent section drafts.
 */
export function SettingsPage() {
  const { t } = useTranslation();
  const id = useId();
  const [active, setActive] = useState<Section>("general");
  const [visited, setVisited] = useState<Section[]>(["general"]);
  const [storageBusy, setStorageBusy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [storageDirty, setStorageDirty] = useState(false);
  const [backupDirty, setBackupDirty] = useState(false);
  const busy = storageBusy || backupBusy;

  /**
   * Activate a section while retaining previously opened forms and their drafts.
   * @param section The settings section to open.
   */
  function select(section: Section) {
    if (busy) return;
    setVisited((current) =>
      current.includes(section) ? current : [...current, section],
    );
    setActive(section);
  }

  return (
    <div className="w-full max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-heading sm:text-3xl">
          {t("settings.title")}
        </h1>
        <p className="mt-2 text-sm text-muted">{t("settings.description")}</p>
      </header>
      <div
        role="tablist"
        aria-label={t("settings.sectionsLabel")}
        className="mb-6 flex gap-1 overflow-x-auto border-b border-shell"
      >
        {sections.map((section, index) => (
          <button
            key={section}
            id={`${id}-${section}-tab`}
            role="tab"
            type="button"
            aria-selected={active === section}
            aria-controls={`${id}-${section}-panel`}
            tabIndex={active === section ? 0 : -1}
            disabled={busy && active !== section}
            onClick={() => select(section)}
            onKeyDown={(event) => {
              if (
                busy ||
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? sections.length - 1
                    : (index +
                        (event.key === "ArrowLeft" ? -1 : 1) +
                        sections.length) %
                      sections.length;
              select(sections[next]!);
              const nextTab = event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                .item(next);
              nextTab?.focus();
            }}
            className={`shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2 disabled:opacity-50 ${active === section ? "border-accent text-accent" : "border-transparent text-muted enabled:hover:bg-surface-hover enabled:hover:text-heading"}`}
          >
            {t(`settings.sections.${section}`)}
          </button>
        ))}
      </div>
      {sections.map((section) => (
        <section
          key={section}
          id={`${id}-${section}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${section}-tab`}
          hidden={active !== section}
          tabIndex={0}
          className="focus-visible:outline-2 focus-visible:outline-accent"
        >
          {visited.includes(section) && (
            <>
              <h2 className="mb-5 text-lg font-semibold text-heading">
                {t(`settings.sections.${section}`)}
              </h2>
              {section === "general" && <GeneralSettings disabled={busy} />}
              {section === "storage" && (
                <fieldset
                  disabled={backupBusy}
                  className="min-w-0 disabled:opacity-60"
                >
                  <StorageSettings
                    onBusyChange={setStorageBusy}
                    onDirtyChange={setStorageDirty}
                  />
                </fieldset>
              )}
              {section === "backups" && (
                <fieldset
                  disabled={storageBusy}
                  className="min-w-0 disabled:opacity-60"
                >
                  <BackupSettings
                    active={active === "backups"}
                    onBusyChange={setBackupBusy}
                    onDirtyChange={setBackupDirty}
                  />
                </fieldset>
              )}
              {section === "about" && <AboutSettings />}
            </>
          )}
        </section>
      ))}
      <UnsavedTableChanges
        context="settings"
        dirty={storageDirty || backupDirty}
        saving={busy}
        onDiscard={() => {}}
      />
    </div>
  );
}
