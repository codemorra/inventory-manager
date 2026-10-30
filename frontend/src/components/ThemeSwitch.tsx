import { useId } from "react";
import { ChoiceSelect } from "./ChoiceSelect";
import { useTranslation } from "react-i18next";

import { useTheme } from "../hooks/useTheme";
import type { ThemePreference } from "../appearance/theme";

// Render the control used to select the application theme.
export function ThemeSwitch() {
  const { t } = useTranslation();
  const id = useId();
  const { theme, setTheme } = useTheme();

  return (
    <ChoiceSelect
      id={id}
      label={t("common.theme.label")}
      compact
      onChange={(value) => setTheme(value as ThemePreference)}
      value={theme}
      options={[
        { value: "system", label: t("common.theme.system") },
        { value: "light", label: t("common.theme.light") },
        { value: "dark", label: t("common.theme.dark") },
      ]}
    />
  );
}
