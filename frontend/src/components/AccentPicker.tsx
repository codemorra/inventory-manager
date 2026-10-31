import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useStoredPreference } from "../hooks/useStoredPreference";

import { accentColors, applyAccent } from "../appearance/accent";

// Render the stored accent color selection for the application.
export function AccentPicker() {
  const { t } = useTranslation();
  const [saved, setAccent] = useStoredPreference("accent");
  const accent = saved ?? "turquoise";

  useEffect(() => {
    applyAccent(accent);
  }, [accent]);

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-medium text-muted">
        {t("common.accent.label")}
      </legend>
      <div className="flex max-w-xs flex-wrap gap-2">
        {accentColors.map((color) => (
          <button
            title={t(`common.accent.${color}`)}
            aria-label={t(`common.accent.${color}`)}
            aria-pressed={accent === color}
            className="grid size-8 place-items-center rounded-md border border-shell bg-surface text-foreground outline-none transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-muted aria-pressed:border-accent aria-pressed:bg-accent-soft"
            key={color}
            onClick={() => setAccent(color)}
            type="button"
          >
            <span
              aria-hidden="true"
              data-accent={color}
              className="accent-swatch size-4 rounded-sm bg-accent"
            />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
