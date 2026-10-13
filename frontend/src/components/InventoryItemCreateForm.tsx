import { type SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCreateInventoryItem } from "../hooks/useInventoryItems";
import { ApiError } from "../services/api";
import { Modal } from "./Modal";
import type { InventoryField } from "../types/inventoryField";
import {
  createValueInput,
  getInitialValue,
  type InventoryItemFormValue,
} from "./inventoryItemForm";
// Define properties for the inventory item creation form.
interface InventoryItemCreateFormProps {
  inventoryId: string;
  fields: InventoryField[];
}

// Define properties for a field-specific form control.
interface InventoryItemFieldInputProps {
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
}: InventoryItemFieldInputProps) {
  const { t } = useTranslation();
  const inputId = `${idPrefix}-${field.id}`;
  const inputClassName =
    "mt-1.5 w-full rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50";

  if (field.field_type === "boolean") {
    return (
      <label
        className="flex items-center gap-3 rounded-lg border border-shell bg-surface-muted px-3 py-2.5"
        htmlFor={inputId}
      >
        <input
          checked={value === true}
          className="size-4 rounded border-shell accent-accent"
          disabled={disabled}
          id={inputId}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span className="text-sm font-medium">{field.name}</span>
      </label>
    );
  }

  if (field.field_type === "select") {
    return (
      <label
        className="block text-sm font-medium text-foreground"
        htmlFor={inputId}
      >
        {field.name}
        <select
          className={inputClassName}
          disabled={disabled}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          value={typeof value === "string" ? value : ""}
        >
          <option value="">{t("items.noSelection")}</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (field.field_type === "multiselect") {
    return (
      <div>
        <label
          className="block text-sm font-medium text-foreground"
          htmlFor={inputId}
        >
          {field.name}
          <select
            aria-describedby={`${inputId}-help`}
            className={`${inputClassName} min-h-28`}
            disabled={disabled}
            id={inputId}
            multiple
            onChange={(event) =>
              onChange(
                Array.from(
                  event.target.selectedOptions,
                  (option) => option.value,
                ),
              )
            }
            value={Array.isArray(value) ? value : []}
          >
            {field.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <span
          className="mt-1.5 block text-xs font-normal text-muted"
          id={`${inputId}-help`}
        >
          {t("items.selectMultiple")}
        </span>
      </div>
    );
  }

  const inputType = {
    date: "date",
    datetime: "datetime-local",
    duration: "number",
    number: "number",
    text: "text",
    time: "time",
  }[field.field_type];

  return (
    <label
      className="block text-sm font-medium text-foreground"
      htmlFor={inputId}
    >
      {field.name}
      <input
        className={inputClassName}
        disabled={disabled}
        id={inputId}
        maxLength={field.max_length ?? undefined}
        min={field.field_type === "duration" ? 0 : undefined}
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
 * @returns The inventory item creation control.
 */
export function InventoryItemCreateForm({
  inventoryId,
  fields,
}: InventoryItemCreateFormProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [values, setValues] = useState<Record<string, InventoryItemFormValue>>(
    {},
  );
  const createItem = useCreateInventoryItem();

  // Close the creation modal while no request is pending.
  function closeModal() {
    if (!createItem.isPending) {
      setIsOpen(false);
    }
  }

  /**
   * Submit the item values entered in the creation form.
   * @param event The form submission event.
   */
  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

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
        onSuccess: () => {
          setValues({});
          setIsOpen(false);
        },
      },
    );
  }

  return (
    <>
      <button
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        disabled={fields.length === 0}
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          +
        </span>
        {t("items.actions.new")}
      </button>

      {fields.length === 0 && (
        <p className="mt-2 text-sm text-muted">{t("items.noFields.hint")}</p>
      )}

      {isOpen && (
        <Modal onClose={closeModal} title={t("items.titles.create")}>
          <form onSubmit={handleSubmit}>
            <p className="text-sm leading-relaxed text-muted">
              {t("items.formDescription")}
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {fields.map((field) => (
                <InventoryItemFieldInput
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
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={createItem.isPending}
                type="submit"
              >
                {createItem.isPending
                  ? t("items.actions.adding")
                  : t("items.actions.add")}
              </button>
              <button
                className="rounded-lg border border-shell px-4 py-2.5 text-sm font-semibold transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
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
