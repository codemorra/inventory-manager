import { useTranslation } from "react-i18next";
import { LanguageSwitch } from "./LanguageSwitch";
import { ThemeSwitch } from "./ThemeSwitch";
import { AccentPicker } from "./AccentPicker";
import { useAttachmentWarnings } from "../hooks/useAttachmentWarnings";

/**
 * Edit automatically saved appearance, language and attachment-warning preferences.
 * @param disabled Whether a storage or backup operation temporarily locks preferences.
 * @returns General appearance, language and file-warning controls.
 */
export function GeneralSettings({ disabled = false }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const [warning, setWarning] = useAttachmentWarnings();
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-6 disabled:opacity-60"
    >
      <div className="w-full max-w-48">
        <LanguageSwitch />
      </div>
      <div className="grid items-start gap-5 border-t border-shell pt-5 sm:grid-cols-[12rem_max-content]">
        <div className="w-full max-w-48">
          <ThemeSwitch />
        </div>
        <AccentPicker />
      </div>
      <div className="border-t border-shell pt-5">
        <label className="flex items-start gap-3 text-sm text-heading">
          <input
            type="checkbox"
            aria-label={t("settings.fileWarnings")}
            checked={warning === "show"}
            onChange={(event) =>
              setWarning(event.currentTarget.checked ? "show" : "hide")
            }
            className="mt-0.5 size-4 shrink-0 accent-accent"
          />
          <span>
            <span className="block font-medium">
              {t("settings.fileWarnings")}
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">
              {t("settings.fileWarningsHelp")}
            </span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
