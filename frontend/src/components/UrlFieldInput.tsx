import { useTranslation } from "react-i18next";
import { isWebAddress, type UrlInput } from "./url";

// Define the controls for a web address and its optional display text.
interface UrlFieldInputProps {
  id: string;
  label: string;
  value: UrlInput;
  required: boolean;
  disabled: boolean;
  onChange: (value: UrlInput) => void;
}

/**
 * Edit an HTTP(S) link without saving until the containing item form is submitted.
 * @param id The prefix identifying the address, label, and help text.
 * @param label The inventory field name shown above the controls.
 * @param value The current address and optional display text.
 * @param required Whether an address is required when saving the item.
 * @param disabled Whether editing is blocked during an item mutation.
 * @param onChange Update the local structured link value.
 * @returns The themed address and link text controls with validation feedback.
 */
export function UrlFieldInput({
  id,
  label,
  value,
  required,
  disabled,
  onChange,
}: UrlFieldInputProps) {
  const { t } = useTranslation();
  const invalid =
    value.url !== "" ? !isWebAddress(value.url) : Boolean(value.label?.trim());
  const inputClass =
    "mt-1.5 w-full rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="text-sm font-medium text-foreground">
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-accent-text">
            *
          </span>
        )}
      </legend>
      <div className="mt-2 space-y-3">
        <label className="block text-sm font-medium" htmlFor={`${id}-address`}>
          {t("items.url.address")}
          <input
            id={`${id}-address`}
            type="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-label={`${label}: ${t("items.url.address")}`}
            className={inputClass}
            value={value.url}
            required={required}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ""}`}
            onChange={(event) =>
              onChange({ ...value, url: event.target.value })
            }
          />
        </label>
        <label className="block text-sm font-medium" htmlFor={`${id}-label`}>
          {t("items.url.label")}
          <input
            id={`${id}-label`}
            type="text"
            aria-label={`${label}: ${t("items.url.label")}`}
            className={inputClass}
            value={value.label ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, label: event.target.value })
            }
          />
        </label>
      </div>
      <p id={`${id}-help`} className="mt-1.5 text-xs text-muted">
        {t("items.url.help")}
      </p>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">
          {t("items.url.invalid")}
        </p>
      )}
    </fieldset>
  );
}
