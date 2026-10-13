import { useEffect, useState } from "react";

import {
  applyTheme,
  getInitialThemePreference,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "../appearance/theme";

/**
 * Manage the stored theme preference and system theme changes.
 * @returns The current preference and its update function.
 */
export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(
    getInitialThemePreference,
  );

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);

    if (theme !== "system" || typeof window.matchMedia !== "function") {
      return;
    }

    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

    // Apply system appearance changes while the application is open.
    function handleSystemThemeChange() {
      applyTheme("system");
    }

    systemTheme.addEventListener("change", handleSystemThemeChange);
    return () =>
      systemTheme.removeEventListener("change", handleSystemThemeChange);
  }, [theme]);

  return { theme, setTheme };
}
