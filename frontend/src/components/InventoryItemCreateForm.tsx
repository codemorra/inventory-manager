import { type SyntheticEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCreateInventoryItem } from "../hooks/useInventoryItems";
import { ApiError } from "../services/api";
import { Modal } from "./Modal";
import { ChoiceSelect } from "./ChoiceSelect";
import { DurationFieldInput } from "./DurationFieldInput";
import { UrlFieldInput } from "./UrlFieldInput";
import { isUrlInput } from "./url";
import { AttachmentFieldInput } from "./AttachmentFieldInput";
import type { AttachmentDraft } from "./attachmentDraft";
import { useAttachmentDraft } from "../hooks/useAttachmentDraft";
import { emptyDuration, isDurationInput } from "./duration";
import type { InventoryField } from "../types/inventoryField";
import {
  createValueInput,
  getInitialValue,
  hasValidItemValues,
  type InventoryItemFormValue,
} from "./inventoryItemForm";
// Define properties for the inventory item creation form.
interface InventoryItemCreateFormProps {
  inventoryId: string;
  fields: InventoryField[];
  compact?: boolean;
  disabled?: boolean;
}

// Define properties for a field-specific form control.
interface InventoryItemFieldInputProps {
  attachments?: AttachmentDraft | undefined;
  idPrefix: string;
  disabled: boolean;
  field: InventoryField;
  onChange: (value: InventoryItemFormValue) => void;
  value: InventoryItemFormValue;
}

/**
 * Render the input control matching an inventory field type.
 * @param idPrefix The prefix for the input element's ID.
 * @param disabled Whether the input should be disabled.
 * @param field The inventory field definition.
 * @param onChange Callback to handle changes to the input value.
 * @param value The current value of the input.
 * @returns The form control matching the configured field type.
 */
export function InventoryItemFieldInput({
  idPrefix,
  disabled,
  field,
  onChange,
  value,
  attachments,
}: InventoryItemFieldInputProps) {
  const { t } = useTranslation();
  const inputId = `${idPrefix}-${field.id}`;
  if (field.field_type === "attachment")
    return (
      <div className="min-w-0 md:col-span-2">
        <AttachmentFieldInput
          id={inputId}
          field={field}
          value={Array.isArray(value) ? value : []}
          disabled={disabled}
          draft={attachments}
          onChange={onChange}
        />
      </div>
    );
  if (field.field_type === "url")
    return (
      <div className="min-w-0 md:col-span-2">
        <UrlFieldInput
          id={inputId}
          label={field.name}
          value={isUrlInput(value) ? value : { url: "", label: "" }}
          required={field.is_required}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    );
  if (field.field_type === "id")
    return (
      <label
        className="block min-w-0 text-sm font-medium text-foreground"
        htmlFor={inputId}
      >
        {field.name}
        <input
          id={inputId}
          className="mt-1.5 block min-h-10.5 w-full min-w-0 rounded-md border border-shell bg-surface-muted px-3 py-2.5 text-sm text-muted"
          readOnly
          value={typeof value === "string" ? value : ""}
          placeholder={t("items.automaticId")}
        />
      </label>
    );
  const fieldLabel = (
    <>
      {field.name}
      {field.is_required && (
        <span aria-hidden="true" className="ml-1 text-accent-text">
          *
        </span>
      )}
    </>
  );
  const inputClassName =
    "mt-1.5 block min-h-10.5 w-full min-w-0 rounded-md border border-shell bg-surface px-3 py-2.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50";

  // Required yes/no fields need an explicit answer rather than a checked-by-default input.
  if (field.field_type === "boolean" && field.is_required) {
    return (
      <ChoiceSelect
        portal
        id={inputId}
        label={field.name}
        required
        disabled={disabled}
        value={typeof value === "boolean" ? String(value) : ""}
        onChange={(next) => onChange(next === "" ? "" : next === "true")}
        options={[
          { value: "", label: t("items.noSelection") },
          { value: "true", label: t("common.values.yes") },
          { value: "false", label: t("common.values.no") },
        ]}
      />
    );
  }

  if (field.field_type === "boolean" || field.field_type === "checkbox") {
    return (
      <div className="min-w-0">
        <label
          className="block text-sm font-medium text-foreground"
          htmlFor={inputId}
        >
          {fieldLabel}
        </label>
        <label
          className={`mt-1.5 flex min-h-10.5 items-center gap-3 rounded-md border border-shell bg-surface px-3 py-2.5 text-sm transition focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-accent/50"}`}
        >
          <input
            checked={value === true}
            className="size-4 shrink-0 rounded-sm border-shell accent-accent"
            disabled={disabled}
            id={inputId}
            onChange={(event) => onChange(event.target.checked)}
            type="checkbox"
          />
          <span aria-hidden="true" className="text-muted">
            {t(value === true ? "common.values.yes" : "common.values.no")}
          </span>
        </label>
      </div>
    );
  }

  if (field.field_type === "select" || field.field_type === "multiselect") {
    const options = field.options.map((option) => ({
      value: option.id,
      label: option.name,
    }));
    const selected = Array.isArray(value)
      ? value
      : typeof value === "string" && value
        ? [value]
        : [];
    // Retain unavailable saved options visibly until the user deliberately clears or replaces them.
    for (const id of selected)
      if (!options.some((option) => option.value === id))
        options.push({ value: id, label: t("items.unavailableOption") });
    return (
      <div className="min-w-0">
        {field.field_type === "multiselect" ? (
          <ChoiceSelect
            portal
            id={inputId}
            label={field.name}
            describedBy={`${inputId}-help`}
            multiple
            required={field.is_required}
            disabled={disabled}
            value={Array.isArray(value) ? value : []}
            options={options}
            emptyLabel={t("items.noSelection")}
            onChange={onChange}
          />
        ) : (
          <ChoiceSelect
            portal
            id={inputId}
            label={field.name}
            required={field.is_required}
            disabled={disabled}
            value={typeof value === "string" ? value : ""}
            options={[{ value: "", label: t("items.noSelection") }, ...options]}
            onChange={onChange}
          />
        )}
        {field.field_type === "multiselect" && (
          <p id={`${inputId}-help`} className="mt-1.5 text-xs text-muted">
            {t(options.length ? "items.selectMultiple" : "items.noOptions")}
          </p>
        )}
      </div>
    );
  }

  if (field.field_type === "duration")
    return (
      <div className="min-w-0 md:col-span-2">
        <DurationFieldInput
          id={inputId}
          label={field.name}
          required={field.is_required}
          disabled={disabled}
          value={isDurationInput(value) ? value : emptyDuration()}
          onChange={onChange}
        />
      </div>
    );

  const inputType = {
    date: "date",
    datetime: "datetime-local",
    number: "number",
    text: "text",
    time: "time",
  }[field.field_type];

  return (
    <label
      className="block min-w-0 text-sm font-medium text-foreground"
      htmlFor={inputId}
    >
      {fieldLabel}
      <input
        className={inputClassName}
        disabled={disabled}
        id={inputId}
        maxLength={field.max_length ?? undefined}
        required={field.is_required}
        onChange={(event) => onChange(event.target.value)}
        step={field.field_type === "number" ? "any" : undefined}
        type={inputType}
        value={typeof value === "string" ? value : ""}
      />
    </label>
  );
}

/**
 * Render a modal form that creates inventory items.
 * @param inventoryId The inventory that will receive the new item.
 * @param fields The fields available for item values.
 * @param compact Whether the creation button fits the compact table menu bar.
 * @returns The inventory item creation control.
 */
export function InventoryItemCreateForm({
  inventoryId,
  fields,
  compact = false,
  disabled = false,
}: InventoryItemCreateFormProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState<Record<string, InventoryItemFormValue>>(
    {},
  );
  const createItem = useCreateInventoryItem();
  const attachments = useAttachmentDraft();
  const submitting = useRef(false);

  // Close the creation modal while no request is pending.
  function closeModal() {
    if (!submitting.current) {
      attachments.controller.discard();
      setValues({});
      setIsOpen(false);
    }
  }

  /**
   * Submit the item values entered in the creation form.
   * @param event The form submission event.
   */
  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      submitting.current ||
      attachments.controller.getSnapshot().busy ||
      !hasValidItemValues(fields, values)
    )
      return;
    submitting.current = true;

    const itemValues = fields.flatMap((field) => {
      const value = values[field.id] ?? getInitialValue(field);
      const input = createValueInput(field, value);

      return input ? [input] : [];
    });

    createItem.mutate(
      {
        inventoryId,
        data: { values: itemValues },
      },
      {
        onSuccess: (item) => {
          attachments.controller.finish([item]);
          setValues({});
          setIsOpen(false);
        },
        onSettled: () => {
          submitting.current = false;
        },
      },
    );
  }

  return (
    <>
      <button
        className={`inline-flex cursor-pointer items-center justify-center gap-2 bg-accent text-sm font-semibold text-surface transition enabled:hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "size-8 shrink-0 rounded-sm" : "rounded-lg px-4 py-2.5"}`}
        aria-label={t("items.actions.new")}
        title={t("items.actions.new")}
        disabled={disabled || fields.length === 0}
        onClick={() => {
          attachments.controller.begin();
          setIsOpen(true);
        }}
        type="button"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          +
        </span>
        {!compact && t("items.actions.new")}
      </button>

      {!compact && fields.length === 0 && (
        <p className="mt-2 text-sm text-muted">{t("items.noFields.hint")}</p>
      )}

      {isOpen && (
        <Modal onClose={closeModal} title={t("items.titles.create")}>
          <form onSubmit={handleSubmit}>
            <p className="text-sm leading-relaxed text-muted">
              {t("items.formDescription")}
            </p>
            {fields.some((field) => field.is_required) && (
              <p className="mt-2 text-xs text-muted">
                {t("items.requiredHint")}
              </p>
            )}
            <div className="mt-5 grid items-start gap-x-5 gap-y-5 md:grid-cols-2">
              {fields.map((field) => (
                <InventoryItemFieldInput
                  attachments={attachments.controller}
                  disabled={createItem.isPending}
                  field={field}
                  idPrefix="create-inventory-item"
                  key={field.id}
                  onChange={(value) =>
                    setValues((currentValues) => ({
                      ...currentValues,
                      [field.id]: value,
                    }))
                  }
                  value={values[field.id] ?? getInitialValue(field)}
                />
              ))}
            </div>

            {createItem.error && (
              <p
                className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
                role="alert"
              >
                {createItem.error instanceof ApiError
                  ? createItem.error.message
                  : t("items.errors.create")}
              </p>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition enabled:hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  createItem.isPending ||
                  !hasValidItemValues(fields, values) ||
                  attachments.busy
                }
                type="submit"
              >
                {createItem.isPending
                  ? t("items.actions.adding")
                  : t("items.actions.add")}
              </button>
              <button
                className="rounded-lg border border-shell px-4 py-2.5 text-sm font-semibold transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={createItem.isPending}
                onClick={closeModal}
                type="button"
              >
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
