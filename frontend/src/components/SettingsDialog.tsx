import { useState, useSyncExternalStore } from "react";
import { preferenceStore } from "../preferences/store";
import { useTranslation } from "react-i18next";

import { LanguageSwitch } from "./LanguageSwitch";
import { Modal } from "./Modal";
import { AccentPicker } from "./AccentPicker";
import { ThemeSwitch } from "./ThemeSwitch";
import { StorageSettings } from "./StorageSettings";
import { useAttachmentWarnings } from "../hooks/useAttachmentWarnings";

// Define properties for the application settings dialog.
interface SettingsDialogProps {
  onClose: () => void;
}

/**
 * Render application settings with immediate persistence.
 * @param onClose Callback invoked when the settings dialog is dismissed.
 * @returns The application settings dialog.
 */
export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { t } = useTranslation();
  const [warning, setWarning] = useAttachmentWarnings();
  const [storageOpen, setStorageOpen] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);
  const persistence = useSyncExternalStore(
    preferenceStore.subscribe,
    preferenceStore.getStatus,
    preferenceStore.getStatus,
  );

  return (
    <Modal onClose={onClose} title={t("settings.title")} size="medium">
      <p className="mb-5 text-sm leading-relaxed text-muted">
        {t("settings.description")}
      </p>
      <fieldset
        disabled={storageBusy}
        className="grid max-w-sm gap-5 disabled:opacity-60"
      >
        <LanguageSwitch />
        <ThemeSwitch />
        <AccentPicker />
        <div className="border-t border-shell pt-4">
          <button
            type="button"
            disabled={warning === "show"}
            onClick={() => setWarning("show")}
            className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
          >
            {t("attachments.restoreWarnings")}
          </button>
        </div>
      </fieldset>
      <details
        className="mt-5 border-t border-shell pt-4"
        onToggle={(event) => setStorageOpen(event.currentTarget.open)}
      >
        <summary className="cursor-pointer text-sm font-semibold text-heading">
          {t("storage.title")}
        </summary>
        {storageOpen && <StorageSettings onBusyChange={setStorageBusy} />}
      </details>
      <p className="mt-5 border-t border-shell pt-4 text-xs text-muted">
        {t(
          persistence.failed
            ? "preferences.unsaved"
            : persistence.pending
              ? "preferences.saving"
              : "settings.savedAutomatically",
        )}
      </p>
    </Modal>
  );
}
