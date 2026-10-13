import { type SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { useCreateInventoryField } from "../hooks/useInventoryFields";
import { ApiError } from "../services/api";
import type { InventoryFieldType } from "../types/inventoryField";
import { Modal } from "./Modal";

// Define properties for an inventory field creation form.
interface InventoryFieldCreateFormProps {
  inventoryId: string;
}

// Define the field types available during field creation.
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
 * @returns The inventory field creation control.
 */
export function InventoryFieldCreateForm({
  inventoryId,
}: InventoryFieldCreateFormProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
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

  // Close the creation modal while no request is pending.
  function closeModal() {
    if (!createInventoryField.isPending) {
      setIsOpen(false);
    }
  }

  /**
   * Update configuration inputs for the selected field type.
   * @param nextFieldType The newly selected field type.
   */
  function changeFieldType(nextFieldType: InventoryFieldType) {
    setFieldType(nextFieldType);
    setMaxLength(nextFieldType === "text" ? "255" : "");
    setOptions(supportsOptions(nextFieldType) ? [""] : []);
  }

  /**
   * Submit the inventory field creation form.
   * @param event The form submission event.
   */
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
          setIsOpen(false);
        },
      },
    );
  }

  return (
    <>
      <button
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          +
        </span>
        {t("fields.actions.new")}
      </button>

      {isOpen && (
        <Modal onClose={closeModal} title={t("fields.titles.create")}>
          <form onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-foreground">
                {t("fields.form.fieldName")}
                <input
                  className="mt-1.5 w-full rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                  maxLength={255}
                  onChange={(event) => setName(event.target.value)}
                  required
                  value={name}
                />
              </label>
              <label className="text-sm font-medium text-foreground">
                {t("fields.form.fieldType")}
                <select
                  className="mt-1.5 w-full rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
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
              <label className="mt-5 block max-w-xs text-sm font-medium text-foreground">
                {t("fields.form.maximumLength")}
                <input
                  className="mt-1.5 w-full rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
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
              <fieldset className="mt-5 rounded-xl border border-shell bg-surface-muted p-4">
                <legend className="text-sm font-medium">
                  {t("fields.form.options")}
                </legend>
                <div className="mt-2 space-y-2">
                  {options.map((option, index) => (
                    <div className="flex gap-2" key={index}>
                      <input
                        aria-label={t("fields.form.option", {
                          number: index + 1,
                        })}
                        className="w-full rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
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
                          className="rounded-lg border border-shell px-3 py-2 text-sm font-medium text-danger transition hover:bg-danger-soft"
                          onClick={() =>
                            setOptions((current) =>
                              current.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
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
                  className="mt-3 rounded-lg border border-shell px-3 py-2 text-sm font-medium transition hover:bg-surface-hover"
                  onClick={() => setOptions((current) => [...current, ""])}
                  type="button"
                >
                  {t("fields.actions.addOption")}
                </button>
              </fieldset>
            )}
            {createInventoryField.error && (
              <p
                className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
                role="alert"
              >
                {createInventoryField.error instanceof ApiError
                  ? createInventoryField.error.message
                  : t("fields.errors.create")}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                className="rounded-lg border border-shell px-4 py-2.5 text-sm font-semibold transition hover:bg-surface-hover disabled:opacity-50"
                disabled={createInventoryField.isPending}
                onClick={closeModal}
                type="button"
              >
                {t("common.actions.cancel")}
              </button>
              <button
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={createInventoryField.isPending || !canSubmit}
                type="submit"
              >
                {createInventoryField.isPending
                  ? t("fields.actions.adding")
                  : t("fields.actions.add")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
