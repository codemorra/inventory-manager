import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "./locales/de.json";
import en from "./locales/en.json";

// Resolve the initial interface language from the client locale.
function getInitialLanguage(): "de" | "en" {
  if (typeof window === "undefined") {
    return "en";
  }

  return navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}

void i18n.use(initReactI18next).init({
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  lng: getInitialLanguage(),
  resources: {
    de: { translation: de },
    en: { translation: en },
  },
});

i18n.on("languageChanged", (language) => {
  const supportedLanguage = language.startsWith("de") ? "de" : "en";

  if (typeof window !== "undefined") {
    document.documentElement.lang = supportedLanguage;
  }
});

if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.resolvedLanguage ?? "en";
}

export default i18n;
