import { useTranslation } from "react-i18next";

import { LanguageSwitch } from "./LanguageSwitch";
import { Modal } from "./Modal";
import { AccentPicker } from "./AccentPicker";
import { ThemeSwitch } from "./ThemeSwitch";
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

  return (
    <Modal onClose={onClose} title={t("settings.title")} size="small">
      <p className="mb-5 text-sm leading-relaxed text-muted">
        {t("settings.description")}
      </p>
      <div className="grid max-w-sm gap-5">
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
      </div>
      <p className="mt-5 border-t border-shell pt-4 text-xs text-muted">
        {t("settings.savedAutomatically")}
      </p>
    </Modal>
  );
}
