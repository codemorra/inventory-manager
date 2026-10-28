import { preferenceStore } from "../preferences/store";

// Define the supported accent palettes.
export const accentColors = ["teal", "blue", "purple", "orange"] as const;
export type AccentColor = (typeof accentColors)[number];

/**
 * Read the stored accent color with a fallback for unsupported values.
 * @returns The stored accent color or teal.
 */
export function getInitialAccent(): AccentColor {
  if (typeof window === "undefined") return "teal";
  const stored = preferenceStore.readPreferences()?.accent;
  return accentColors.find((color) => color === stored) ?? "teal";
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
