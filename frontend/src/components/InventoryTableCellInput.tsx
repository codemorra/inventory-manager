import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InventoryField } from "../types/inventoryField";
import type { InventoryItemFormValue } from "./inventoryItemForm";
import type { TableCellError } from "./inventoryTableDraft";
import { validEditedTemporal } from "./inventoryTableDraft";
import { ChoiceSelect } from "./ChoiceSelect";
import { DurationFieldInput } from "./DurationFieldInput";
import { emptyDuration, isDurationInput } from "./duration";
import { isUrlInput } from "./url";

interface InventoryTableCellInputProps {
  id: string;
  field: InventoryField;
  value: InventoryItemFormValue;
  disabled: boolean;
  error?: TableCellError["error"];
  onChange: (value: InventoryItemFormValue) => void;
}

/**
 * Render compact typed controls inside a table cell without changing untouched stored values.
 * @param props The snapshot field, draft value, validation state, and local change action.
 * @returns An accessible cell control, with portal choices and an adjacent field error.
 */
export function InventoryTableCellInput({
  id,
  field,
  value,
  disabled,
  error,
  onChange,
}: InventoryTableCellInputProps) {
  const { t } = useTranslation();
  // Native controls must not erase legacy ISO forms they cannot display.
  const [inputType] = useState(() => {
    if (
      ["date", "time", "datetime"].includes(field.field_type) &&
      (value === "" ||
        (typeof value === "string" &&
          validEditedTemporal(field.field_type, value)))
    )
      return field.field_type === "datetime"
        ? "datetime-local"
        : field.field_type;
    return "text";
  });
  const describedBy = error ? `${id}-error` : undefined;
  const inputClass =
    "w-full min-w-0 rounded-sm border border-shell bg-surface px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-60";
  let control;
  if (field.field_type === "checkbox")
    control = (
      <input
        id={id}
        type="checkbox"
        aria-label={field.name}
        aria-describedby={describedBy}
        disabled={disabled}
        checked={value === true}
        className="size-4 cursor-pointer accent-accent"
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  else if (field.field_type === "boolean")
    control = (
      <ChoiceSelect
        compact
        portal
        id={id}
        label={field.name}
        describedBy={describedBy}
        disabled={disabled}
        value={typeof value === "boolean" ? String(value) : ""}
        options={[
          { value: "", label: t("items.noSelection") },
          { value: "true", label: t("common.values.yes") },
          { value: "false", label: t("common.values.no") },
        ]}
        onChange={(next) => onChange(next === "" ? "" : next === "true")}
      />
    );
  else if (
    field.field_type === "select" ||
    field.field_type === "multiselect"
  ) {
    const options = field.options.map((option) => ({
      value: option.id,
      label: option.name,
    }));
    const selected = Array.isArray(value)
      ? value
      : typeof value === "string" && value
        ? [value]
        : [];
    for (const optionId of selected)
      if (!options.some((option) => option.value === optionId))
        options.push({ value: optionId, label: t("items.unavailableOption") });
    control =
      field.field_type === "multiselect" ? (
        <ChoiceSelect
          compact
          portal
          multiple
          id={id}
          label={field.name}
          describedBy={describedBy}
          options={options}
          value={Array.isArray(value) ? value : []}
          disabled={disabled}
          emptyLabel={t("items.noSelection")}
          onChange={onChange}
        />
      ) : (
        <ChoiceSelect
          compact
          portal
          id={id}
          label={field.name}
          describedBy={describedBy}
          options={[{ value: "", label: t("items.noSelection") }, ...options]}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={onChange}
        />
      );
  } else if (field.field_type === "duration")
    control = (
      <DurationFieldInput
        compact
        id={id}
        label={field.name}
        required={field.is_required}
        disabled={disabled}
        value={isDurationInput(value) ? value : emptyDuration()}
        onChange={onChange}
      />
    );
  else if (field.field_type === "url") {
    const url = isUrlInput(value) ? value : { url: "", label: "" };
    control = (
      <div className="space-y-1.5">
        <input
          id={id}
          type="url"
          aria-label={`${field.name}: ${t("items.url.address")}`}
          aria-describedby={describedBy}
          disabled={disabled}
          className={inputClass}
          placeholder={t("items.url.address")}
          value={url.url}
          onChange={(event) => onChange({ ...url, url: event.target.value })}
        />
        <input
          type="text"
          aria-label={`${field.name}: ${t("items.url.label")}`}
          aria-describedby={describedBy}
          disabled={disabled}
          className={inputClass}
          placeholder={t("items.url.label")}
          value={url.label ?? ""}
          onChange={(event) => onChange({ ...url, label: event.target.value })}
        />
      </div>
    );
  } else if (field.field_type === "text")
    control = (
      <textarea
        id={id}
        rows={1}
        aria-label={field.name}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        disabled={disabled}
        className={`${inputClass} resize-y`}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  else
    control = (
      <input
        id={id}
        type={inputType}
        inputMode={field.field_type === "number" ? "decimal" : undefined}
        step="any"
        aria-label={field.name}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        disabled={disabled}
        className={inputClass}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  return (
    <div className="min-w-0 [&>div>label]:sr-only [&>div>button]:mt-0">
      {control}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">
          {t(`table.edit.validation.${error}`)}
        </p>
      )}
    </div>
  );
}
