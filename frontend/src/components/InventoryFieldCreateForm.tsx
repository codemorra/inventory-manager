import { type SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCreateInventoryField } from "../hooks/useInventoryFields";
import { ApiError } from "../services/api";
import type { InventoryFieldType } from "../types/inventoryField";

/** Define properties for an inventory field creation form. */
interface InventoryFieldCreateFormProps {
  inventoryId: string;
}

const fieldTypes: InventoryFieldType[] = [
  "text",
  "number",
  "boolean",
  "date",
  "time",
  "datetime",
  "duration",
  "select",
  "multiselect",
];

/**
 * Determine if a given field type supports options (select or multiselect).
 * @param fieldType The type of the inventory field.
 * @returns True if the field type supports options, false otherwise.
 */
function supportsOptions(fieldType: InventoryFieldType) {
  return fieldType === "select" || fieldType === "multiselect";
}

/**
 * Render a form that creates a configured inventory field.
 * @param inventoryId The ID of the inventory to which the field will be added.
 */
export function InventoryFieldCreateForm({
  inventoryId,
}: InventoryFieldCreateFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<InventoryFieldType>("text");
  const [maxLength, setMaxLength] = useState("255");
  const [options, setOptions] = useState([""]);
  const createInventoryField = useCreateInventoryField();
  const canSubmit =
    name.trim() &&
    ((fieldType === "text" && Number(maxLength) > 0) ||
      (!supportsOptions(fieldType) && fieldType !== "text") ||
      (supportsOptions(fieldType) &&
        options.length > 0 &&
        options.every((option) => option.trim())));

  // Function to handle changes in the field type selection.
  function changeFieldType(nextFieldType: InventoryFieldType) {
    setFieldType(nextFieldType);
    setMaxLength(nextFieldType === "text" ? "255" : "");
    setOptions(supportsOptions(nextFieldType) ? [""] : []);
  }

  // Function to handle the submission of the inventory field creation form.
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    createInventoryField.mutate(
      {
        inventoryId,
        data: {
          name: name.trim(),
          field_type: fieldType,
          ...(fieldType === "text" && { max_length: Number(maxLength) }),
          ...(supportsOptions(fieldType) && {
            options: options.map((option) => ({ name: option.trim() })),
          }),
        },
      },
      {
        onSuccess: () => {
          setName("");
          setFieldType("text");
          setMaxLength("255");
          setOptions([""]);
        },
      },
    );
  }

  return (
    <form
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      onSubmit={submit}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">
          {t("fields.form.fieldName")}
          <input
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label className="text-sm font-medium">
          {t("fields.form.fieldType")}
          <select
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            onChange={(event) =>
              changeFieldType(event.target.value as InventoryFieldType)
            }
            value={fieldType}
          >
            {fieldTypes.map((type) => (
              <option key={type} value={type}>
                {t(`fields.types.${type}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {fieldType === "text" && (
        <label className="mt-4 block max-w-xs text-sm font-medium">
          {t("fields.form.maximumLength")}
          <input
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            max={10000}
            min={1}
            onChange={(event) => setMaxLength(event.target.value)}
            required
            type="number"
            value={maxLength}
          />
        </label>
      )}
      {supportsOptions(fieldType) && (
        <fieldset className="mt-4">
          <legend className="text-sm font-medium">
            {t("fields.form.options")}
          </legend>
          <div className="mt-2 space-y-2">
            {options.map((option, index) => (
              <div className="flex gap-2" key={index}>
                <input
                  aria-label={t("fields.form.option", { number: index + 1 })}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  maxLength={255}
                  onChange={(event) =>
                    setOptions((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index ? event.target.value : item,
                      ),
                    )
                  }
                  required
                  value={option}
                />
                {options.length > 1 && (
                  <button
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
                    onClick={() =>
                      setOptions((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    {t("common.actions.remove")}
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            className="mt-3 rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
            onClick={() => setOptions((current) => [...current, ""])}
            type="button"
          >
            {t("fields.actions.addOption")}
          </button>
        </fieldset>
      )}
      <button
        className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500"
        disabled={createInventoryField.isPending || !canSubmit}
        type="submit"
      >
        {createInventoryField.isPending
          ? t("fields.actions.adding")
          : t("fields.actions.add")}
      </button>
      {createInventoryField.error && (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {createInventoryField.error instanceof ApiError
            ? createInventoryField.error.message
            : t("fields.errors.create")}
        </p>
      )}
    </form>
  );
}
