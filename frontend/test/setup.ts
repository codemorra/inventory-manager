import { initializePreferences } from "./helpers/preferences";
import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

import i18n from "../src/i18n";

// Initialize independent preferences and reset the language before each test.
beforeEach(async () => {
  if (typeof document !== "undefined") await initializePreferences();
  await i18n.changeLanguage("en");
});
