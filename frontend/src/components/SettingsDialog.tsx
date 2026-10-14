import { useTranslation } from "react-i18next";

import { LanguageSwitch } from "./LanguageSwitch";
import { Modal } from "./Modal";
import { AccentPicker } from "./AccentPicker";
import { ThemeSwitch } from "./ThemeSwitch";

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

  return (
    <Modal onClose={onClose} title={t("settings.title")}>
      <p className="mb-5 text-sm leading-relaxed text-muted">
        {t("settings.description")}
      </p>
      <div className="grid max-w-sm gap-5">
        <LanguageSwitch />
        <ThemeSwitch />
        <AccentPicker />
      </div>
      <p className="mt-5 border-t border-shell pt-4 text-xs text-muted">
        {t("settings.savedAutomatically")}
      </p>
    </Modal>
  );
}
