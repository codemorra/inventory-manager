export const THEME_STORAGE_KEY = "inventory-manager-theme";

// Define the theme choices available to users.
export type ThemePreference = "system" | "light" | "dark";

// Define a theme after resolving the system preference.
type ResolvedTheme = Exclude<ThemePreference, "system">;

/**
 * Determine the theme currently preferred by the operating system.
 * @returns The resolved system theme.
 */
export function getSystemTheme(): ResolvedTheme {
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }

  return "light";
}

/**
 * Read the stored theme preference.
 * @returns The stored preference or the system default.
 */
export function getInitialThemePreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);

  if (storedTheme === "light" || storedTheme === "dark") {
    return storedTheme;
  }

  return "system";
}

/**
 * Apply a theme preference to the document.
 * @param preference The theme preference to resolve and apply.
 */
export function applyTheme(preference: ThemePreference) {
  if (typeof document === "undefined") {
    return;
  }

  const resolvedTheme = preference === "system" ? getSystemTheme() : preference;
  document.documentElement.dataset.theme = resolvedTheme;
}

applyTheme(getInitialThemePreference());
