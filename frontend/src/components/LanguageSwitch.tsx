import { useTranslation } from "react-i18next";

// Render the control used to select the application language.
export function LanguageSwitch() {
  const { i18n, t } = useTranslation();
  const language = i18n.resolvedLanguage?.startsWith("de") ? "de" : "en";

  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted">
      <span>{t("common.language.label")}</span>
      <select
        aria-label={t("common.language.label")}
        className="w-full rounded-lg border border-shell bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
        value={language}
      >
        <option value="en">{t("common.language.en")}</option>
        <option value="de">{t("common.language.de")}</option>
      </select>
    </label>
  );
}
