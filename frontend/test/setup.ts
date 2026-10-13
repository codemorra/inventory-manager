import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";

import i18n from "../src/i18n";

// Clear local storage and reset the language before each test.
beforeEach(async () => {
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
  await i18n.changeLanguage("en");
});
