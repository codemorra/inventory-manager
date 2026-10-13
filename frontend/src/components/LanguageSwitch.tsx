import { useTranslation } from "react-i18next";

// Render the control used to select the application language.
export function LanguageSwitch() {
  const { i18n, t } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith("de") ? "de" : "en";

  return (
    <label className="flex items-center gap-2 text-sm font-medium">
      <span>{t("common.language.label")}</span>
      <select
        aria-label={t("common.language.label")}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
        value={language}
      >
        <option value="en">{t("common.language.en")}</option>
        <option value="de">{t("common.language.de")}</option>
      </select>
    </label>
  );
}
