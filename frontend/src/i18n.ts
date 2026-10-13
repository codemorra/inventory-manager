import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import de from "./locales/de.json";
import en from "./locales/en.json";

export const LANGUAGE_STORAGE_KEY = "inventory-manager-language";

// Get the initial language preference from local storage or the browser.
function getInitialLanguage(): "de" | "en" {
  if (typeof window === "undefined") {
    return "en";
  }

  const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY);

  if (storedLanguage === "de" || storedLanguage === "en") {
    return storedLanguage;
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
    localStorage.setItem(LANGUAGE_STORAGE_KEY, supportedLanguage);
    document.documentElement.lang = supportedLanguage;
  }
});

if (typeof document !== "undefined") {
  document.documentElement.lang = i18n.resolvedLanguage ?? "en";
}

export default i18n;
