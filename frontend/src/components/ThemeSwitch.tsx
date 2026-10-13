import { useTranslation } from "react-i18next";

import { useTheme } from "../hooks/useTheme";
import type { ThemePreference } from "../appearance/theme";

// Render the control used to select the application theme.
export function ThemeSwitch() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();

  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted">
      <span>{t("common.theme.label")}</span>
      <select
        aria-label={t("common.theme.label")}
        className="w-full rounded-lg border border-shell bg-surface px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
        onChange={(event) => setTheme(event.target.value as ThemePreference)}
        value={theme}
      >
        <option value="system">{t("common.theme.system")}</option>
        <option value="light">{t("common.theme.light")}</option>
        <option value="dark">{t("common.theme.dark")}</option>
      </select>
    </label>
  );
}
