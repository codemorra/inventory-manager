import { useTranslation } from "react-i18next";
import { IntegerSpinbox } from "./IntegerSpinbox";
import {
  durationSeconds,
  maximumDurationHours,
  type DurationInput,
} from "./duration";

// Define a duration control that retains empty components until an explicit item save.
interface DurationFieldInputProps {
  id: string;
  label: string;
  value: DurationInput;
  required: boolean;
  disabled: boolean;
  onChange: (value: DurationInput) => void;
  compact?: boolean;
}

/**
 * Render hours, minutes, and seconds using the shared bounded integer controls.
 * @param id The prefix used by the component inputs and help text.
 * @param label The duration field's name.
 * @param value The currently edited duration components.
 * @param required Whether the duration must be supplied before saving the item.
 * @param disabled Whether editing is disabled while saving.
 * @param onChange Update the duration in the containing item form.
 * @returns The labeled duration group and any overflow warning.
 */
export function DurationFieldInput({
  id,
  label,
  value,
  required,
  disabled,
  onChange,
  compact = false,
}: DurationFieldInputProps) {
  const { t } = useTranslation();
  const hasValue = Object.values(value).some((part) => part !== "");
  const invalid = hasValue && durationSeconds(value) === null;
  return (
    <fieldset
      disabled={disabled}
      aria-describedby={compact ? undefined : `${id}-help`}
      className="min-w-0"
    >
      <legend
        className={compact ? "sr-only" : "text-sm font-medium text-foreground"}
      >
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-accent-text">
            *
          </span>
        )}
      </legend>
      <div className={`grid grid-cols-3 ${compact ? "gap-1" : "mt-2 gap-2"}`}>
        {(["hours", "minutes", "seconds"] as const).map((part) => (
          <IntegerSpinbox
            key={part}
            id={`${id}-${part}`}
            label={t(`items.duration.${part}`)}
            describedBy={compact ? undefined : `${id}-help`}
            min={0}
            max={part === "hours" ? maximumDurationHours : 59}
            value={value[part]}
            disabled={disabled}
            onChange={(next) => onChange({ ...value, [part]: next })}
          />
        ))}
      </div>
      {!compact && (
        <p id={`${id}-help`} className="mt-1.5 text-xs text-muted">
          {t("items.duration.help")}
        </p>
      )}
      {invalid && (
        <p className="mt-1 text-xs text-danger" role="alert">
          {t("items.duration.invalid")}
        </p>
      )}
    </fieldset>
  );
}
