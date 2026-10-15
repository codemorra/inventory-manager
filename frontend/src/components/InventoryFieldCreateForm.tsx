import { type SyntheticEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { useInventoryDraft, useDraftEditorLock } from "./InventoryDraftContext";
import type { InventoryFieldType } from "../types/inventoryField";
import { Modal } from "./Modal";
import { InventoryFieldSettings } from "./InventoryFieldSettings";
import { SingleSelect } from "./SingleSelect";
import { IntegerSpinbox } from "./IntegerSpinbox";
import { AutomaticIdSettings } from "./AutomaticIdSettings";

// Define the field types available during field creation.
const fieldTypes: InventoryFieldType[] = [
  "text",
  "number",
  "id",
  "url",
  "boolean",
  "checkbox",
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
 * Render a form that adds a configured field to the local draft.
 * @returns The inventory field creation control.
 */
export function InventoryFieldCreateForm() {
  const { t } = useTranslation();
  const typeHelpId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<InventoryFieldType>("text");
  const [maxLength, setMaxLength] = useState("255");
  const [options, setOptions] = useState([""]);
  const [isRequired, setIsRequired] = useState(false);
  const [isSortable, setIsSortable] = useState(true);
  const [reuseDeletedIds, setReuseDeletedIds] = useState(false);
  const { addField, disabled } = useInventoryDraft();
  useDraftEditorLock("create-field", isOpen);
  const canSubmit =
    name.trim() &&
    ((fieldType === "text" &&
      Number.isInteger(Number(maxLength)) &&
      Number(maxLength) >= 1 &&
      Number(maxLength) <= 1_000) ||
      (!supportsOptions(fieldType) && fieldType !== "text") ||
      (supportsOptions(fieldType) &&
        options.length > 0 &&
        options.every((option) => option.trim())));

  // Restore defaults so a dismissed child form cannot leak into the next field.
  function resetForm() {
    setName("");
    setFieldType("text");
    setMaxLength("255");
    setOptions([""]);
    setIsRequired(false);
    setIsSortable(true);
    setReuseDeletedIds(false);
  }

  // Discard the creation modal while no request is pending.
  function closeModal() {
    if (!disabled) {
      resetForm();
      setIsOpen(false);
    }
  }

  /**
   * Update configuration inputs for the selected field type.
   * @param nextFieldType The newly selected field type.
   */
  function changeFieldType(nextFieldType: InventoryFieldType) {
    setFieldType(nextFieldType);
    if (nextFieldType === "id") setIsRequired(false);
    setMaxLength(nextFieldType === "text" ? "255" : "");
    setOptions(supportsOptions(nextFieldType) ? [""] : []);
  }

  /**
   * Add the field locally; the parent editor persists it on explicit save.
   * @param event The form submission event.
   */
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !canSubmit) return;
    addField({
      name: name.trim(),
      field_type: fieldType,
      is_required: isRequired,
      is_sortable: isSortable,
      ...(fieldType === "id" && { reuse_deleted_ids: reuseDeletedIds }),
      ...(fieldType === "text" && { max_length: Number(maxLength) }),
      ...(supportsOptions(fieldType) && {
        options: options.map((option) => ({ name: option.trim() })),
      }),
    });
    resetForm();
    setIsOpen(false);
  }

  return (
    <>
      <button
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition enabled:hover:bg-accent-hover disabled:opacity-50"
        disabled={disabled}
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          +
        </span>
        {t("fields.actions.new")}
      </button>

      {isOpen && (
        <Modal
          onClose={closeModal}
          title={t("fields.titles.create")}
          size="medium"
        >
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
              <SingleSelect
                id={`${typeHelpId}-type`}
                label={t("fields.form.fieldType")}
                describedBy={typeHelpId}
                disabled={disabled}
                options={fieldTypes.map((type) => ({
                  value: type,
                  label: t(`fields.types.${type}`),
                }))}
                value={fieldType}
                onChange={(value) =>
                  changeFieldType(value as InventoryFieldType)
                }
              />
            </div>
            <p className="mt-3 text-sm text-muted" id={typeHelpId}>
              {t(`fields.typeHelp.${fieldType}`)}
            </p>
            <InventoryFieldSettings
              automatic={fieldType === "id"}
              required={isRequired}
              sortable={isSortable}
              disabled={disabled}
              onRequiredChange={setIsRequired}
              onSortableChange={setIsSortable}
            >
              {fieldType === "id" && (
                <AutomaticIdSettings
                  reuse={reuseDeletedIds}
                  onChange={setReuseDeletedIds}
                />
              )}
              {fieldType === "text" && (
                <div>
                  <IntegerSpinbox
                    id={`${typeHelpId}-limit-input`}
                    label={t("fields.form.maximumLength")}
                    describedBy={`${typeHelpId}-limit`}
                    min={1}
                    max={1000}
                    onChange={setMaxLength}
                    disabled={disabled}
                    required
                    value={maxLength}
                  />
                  <span
                    className="mt-1 block text-xs font-normal text-muted"
                    id={`${typeHelpId}-limit`}
                  >
                    {t("fields.form.textLimitHelp")}
                  </span>
                </div>
              )}
              {supportsOptions(fieldType) && (
                <fieldset className="min-w-0">
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
                            className="rounded-lg border border-shell px-3 py-2 text-sm font-medium text-danger transition enabled:hover:bg-danger/25"
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
                    className="mt-3 rounded-lg border border-shell px-3 py-2 text-sm font-medium transition enabled:hover:bg-control-hover enabled:hover:border-accent/50"
                    onClick={() => setOptions((current) => [...current, ""])}
                    type="button"
                  >
                    {t("fields.actions.addOption")}
                  </button>
                </fieldset>
              )}
            </InventoryFieldSettings>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                className="rounded-lg border border-shell px-4 py-2.5 text-sm font-semibold transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:opacity-50"
                disabled={disabled}
                onClick={closeModal}
                type="button"
              >
                {t("common.actions.cancel")}
              </button>
              <button
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition enabled:hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled || !canSubmit}
                type="submit"
              >
                {disabled
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
