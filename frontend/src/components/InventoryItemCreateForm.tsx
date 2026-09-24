import { type FormEvent, useState } from "react";

import { useCreateInventoryItem } from "../hooks/useInventoryItems";
import { ApiError } from "../services/api";
import type { InventoryField } from "../types/inventoryField";
import type { InventoryItemValueInput } from "../types/inventoryItem";

/** Define values held by inventory item form controls. */
type InventoryItemFormValue = string | boolean | string[];

/** Define properties for the inventory item creation form. */
interface InventoryItemCreateFormProps {
  inventoryId: string;
  fields: InventoryField[];
}

/** Define properties for a field-specific form control. */
interface InventoryItemFieldInputProps {
  disabled: boolean;
  field: InventoryField;
  onChange: (value: InventoryItemFormValue) => void;
  value: InventoryItemFormValue;
}

/** Return the initial form value for an inventory field. */
function getInitialValue(field: InventoryField): InventoryItemFormValue {
  if (field.field_type === "boolean") {
    return false;
  }

  if (field.field_type === "multiselect") {
    return [];
  }

  return "";
}

/** Convert a non-empty form value into its API representation. */
function createValueInput(
  field: InventoryField,
  value: InventoryItemFormValue,
): InventoryItemValueInput | null {
  if (field.field_type === "boolean") {
    return { field_id: field.id, value };
  }

  if (Array.isArray(value)) {
    return value.length ? { field_id: field.id, value } : null;
  }

  if (!value) {
    return null;
  }

  if (field.field_type === "number" || field.field_type === "duration") {
    return { field_id: field.id, value: Number(value) };
  }

  return { field_id: field.id, value };
}

/** Render the input control matching an inventory field type. */
function InventoryItemFieldInput({
  disabled,
  field,
  onChange,
  value,
}: InventoryItemFieldInputProps) {
  const inputId = `inventory-item-field-${field.id}`;
  const inputClassName =
    "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100";

  if (field.field_type === "boolean") {
    return (
      <label
        className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800"
        htmlFor={inputId}
      >
        <input
          checked={value === true}
          className="size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950"
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
      <label className="block text-sm font-medium" htmlFor={inputId}>
        {field.name}
        <select
          className={inputClassName}
          disabled={disabled}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          value={typeof value === "string" ? value : ""}
        >
          <option value="">No selection</option>
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
        <label className="block text-sm font-medium" htmlFor={inputId}>
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
          className="mt-1 block text-xs font-normal text-slate-500 dark:text-slate-400"
          id={`${inputId}-help`}
        >
          Select one or more options.
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
    <label className="block text-sm font-medium" htmlFor={inputId}>
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

/** Render a dynamic form that creates inventory items. */
export function InventoryItemCreateForm({
  inventoryId,
  fields,
}: InventoryItemCreateFormProps) {
  const [values, setValues] = useState<Record<string, InventoryItemFormValue>>(
    {},
  );
  const createItem = useCreateInventoryItem();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
        onSuccess: () => setValues({}),
      },
    );
  }

  return (
    <form
      className="mt-8 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Add item</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Enter the values you want to store in this inventory.
          </p>
        </div>
        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
          disabled={createItem.isPending || fields.length === 0}
          type="submit"
        >
          {createItem.isPending ? "Adding…" : "Add item"}
        </button>
      </div>

      {fields.length > 0 ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {fields.map((field) => (
            <InventoryItemFieldInput
              disabled={createItem.isPending}
              field={field}
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
      ) : (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
          Configure at least one field before adding items.
        </p>
      )}

      {createItem.error && (
        <p className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">
          {createItem.error instanceof ApiError
            ? createItem.error.message
            : "Unable to add inventory item."}
        </p>
      )}
    </form>
  );
}
