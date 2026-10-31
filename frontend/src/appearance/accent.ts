import { preferenceStore } from "../preferences/store";

// Define the supported accent palettes.
export const accentColors = [
  "turquoise",
  "cyan",
  "blue",
  "purple",
  "orange",
  "green",
  "slate",
] as const;
export type AccentColor = (typeof accentColors)[number];

/**
 * Read the stored accent color with a fallback for unsupported values.
 * @returns The stored accent color or the original logo palette.
 */
export function getInitialAccent(): AccentColor {
  if (typeof window === "undefined") return "turquoise";
  const stored = preferenceStore.readPreferences()?.accent;
  return accentColors.find((color) => color === stored) ?? "turquoise";
}

/**
 * Apply an accent palette to the document.
 * @param color The supported accent color to apply.
 */
export function applyAccent(color: AccentColor) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.accent = color;
  }
}

applyAccent(getInitialAccent());
