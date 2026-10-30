import { useId, useSyncExternalStore } from "react";
import { preferenceStore } from "../preferences/store";
import { useTranslation } from "react-i18next";

import { ChoiceSelect } from "./ChoiceSelect";

// Render the control used to select the application language.
export function LanguageSwitch() {
  const { i18n, t } = useTranslation();
  const id = useId();
  const preference = useSyncExternalStore(
    preferenceStore.subscribe,
    () =>
      preferenceStore.isReady()
        ? preferenceStore.readPreferences()?.language
        : undefined,
    () => undefined,
  );
  const language =
    preference ?? (i18n.resolvedLanguage?.startsWith("de") ? "de" : "en");

  return (
    <ChoiceSelect
      id={id}
      label={t("common.language.label")}
      compact
      onChange={(next) => {
        const value =
          next === "system" ? "system" : next === "de" ? "de" : "en";
        preferenceStore.setPreference("language", value);
        void i18n.changeLanguage(
          value === "system"
            ? navigator.language.toLowerCase().startsWith("de")
              ? "de"
              : "en"
            : value,
        );
      }}
      value={language}
      options={[
        { value: "system", label: t("common.language.system") },
        { value: "en", label: t("common.language.en") },
        { value: "de", label: t("common.language.de") },
      ]}
    />
  );
}
