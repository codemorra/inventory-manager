import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useStoredPreference } from "../hooks/useStoredPreference";

import {
  ACCENT_STORAGE_KEY,
  accentColors,
  applyAccent,
  getInitialAccent,
} from "../appearance/accent";

// Render the stored accent color selection for the application.
export function AccentPicker() {
  const { t } = useTranslation();
  const [accent, setAccent] = useStoredPreference(
    ACCENT_STORAGE_KEY,
    getInitialAccent,
  );

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  return (
    <fieldset>
      <legend className="mb-2 text-xs font-medium text-muted">
        {t("common.accent.label")}
      </legend>
      <div className="flex gap-2">
        {accentColors.map((color) => (
          <button
            aria-label={t(`common.accent.${color}`)}
            aria-pressed={accent === color}
            className="grid size-8 place-items-center rounded-md border border-shell bg-surface text-foreground outline-none transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-muted aria-pressed:border-accent aria-pressed:bg-accent-soft"
            key={color}
            onClick={() => setAccent(color)}
            type="button"
          >
            <span
              aria-hidden="true"
              className={`size-4 rounded-sm ${
                {
                  teal: "bg-teal-600",
                  blue: "bg-blue-600",
                  purple: "bg-purple-600",
                  orange: "bg-orange-600",
                }[color]
              }`}
            />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
