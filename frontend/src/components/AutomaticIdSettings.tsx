import { useId } from "react";
import { useTranslation } from "react-i18next";

// Define the local reuse preference for a server-generated ID field.
interface AutomaticIdSettingsProps {
  reuse: boolean;
  onChange: (reuse: boolean) => void;
}

/**
 * Explain automatic numbering and explicitly opt into deleted-number reuse.
 * @param reuse Whether the smallest unused number may be reassigned.
 * @param onChange Update the unsaved field configuration.
 * @returns The reuse checkbox and its warning about old references.
 */
export function AutomaticIdSettings({
  reuse,
  onChange,
}: AutomaticIdSettingsProps) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div>
      <p className="mb-3 text-xs text-muted">
        {t("fields.settings.automaticIdHelp")}
      </p>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={reuse}
          aria-describedby={id}
          onChange={(event) => onChange(event.target.checked)}
        />
        {t("fields.settings.reuseDeletedIds")}
      </label>
      <p className="mt-1 text-xs text-muted" id={id}>
        {t("fields.settings.reuseDeletedIdsHelp")}
      </p>
    </div>
  );
}
