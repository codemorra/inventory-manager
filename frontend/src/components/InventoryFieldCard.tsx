import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";
import { type SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { useInventoryDraft, useDraftEditorLock } from "./InventoryDraftContext";
import type { InventoryField } from "../types/inventoryField";
import { InventoryFieldOptions } from "./InventoryFieldOptions";
import { Modal } from "./Modal";
import { InventoryFieldSettings } from "./InventoryFieldSettings";

// Define properties for an inventory field card.
interface InventoryFieldCardProps {
  inventoryField: InventoryField;
}

/**
 * Render inventory field details and management actions.
 * @param inventoryField The inventory field to display and manage.
 * @returns The field row and its management dialogs.
 */
export function InventoryFieldCard({
  inventoryField,
}: InventoryFieldCardProps) {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(inventoryField.name);
  const [isRequired, setIsRequired] = useState(inventoryField.is_required);
  const [isSortable, setIsSortable] = useState(inventoryField.is_sortable);

  const {
    updateField,
    removeField,
    disabled: isMutating,
  } = useInventoryDraft();
  useDraftEditorLock(`field-${inventoryField.id}`, isEditing || isDeleting);

  // Function to initiate editing of the inventory field.
  function startEditing() {
    setName(inventoryField.name);
    setIsRequired(inventoryField.is_required);
    setIsSortable(inventoryField.is_sortable);
    setIsEditing(true);
  }

  // Function to cancel editing of the inventory field.
  function cancelEditing() {
    setIsEditing(false);
  }

  /**
   * Apply the field name and settings locally without changing its type or text limit.
   * @param event The form submission event.
   */
  function handleUpdate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    updateField(inventoryField.id, {
      name: name.trim(),
      is_required: isRequired,
      is_sortable: isSortable,
    });
    setIsEditing(false);
  }

  // Ask for confirmation before deleting the field.
  function handleDelete() {
    setIsDeleting(true);
  }

  return (
    <article className="bg-surface px-4 py-4">
      {isEditing && (
        <Modal
          size="medium"
          title={t("fields.titles.edit")}
          onClose={() => {
            if (!isMutating) cancelEditing();
          }}
        >
          <form className="space-y-4" onSubmit={handleUpdate}>
            <div className="flex-1">
              <label
                className="mb-1.5 block text-sm font-medium"
                htmlFor={`field-${inventoryField.id}-name`}
              >
                {t("fields.form.fieldName")}
              </label>
              <input
                autoFocus
                disabled={isMutating}
                className="w-full rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                id={`field-${inventoryField.id}-name`}
                maxLength={255}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>

            <p className="text-sm text-muted">
              {t(`fields.types.${inventoryField.field_type}`)} ·{" "}
              {t(`fields.typeHelp.${inventoryField.field_type}`)}
            </p>
            <InventoryFieldSettings
              required={isRequired}
              sortable={isSortable}
              disabled={isMutating}
              onRequiredChange={setIsRequired}
              onSortableChange={setIsSortable}
            />
            <div className="flex justify-end gap-2">
              <button
                className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-surface transition enabled:hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isMutating || !name.trim()}
                type="submit"
              >
                {t("common.actions.save")}
              </button>

              <button
                className="rounded-lg border border-shell px-3 py-2 text-sm font-semibold transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isMutating}
                onClick={cancelEditing}
                type="button"
              >
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="wrap-break-word text-sm font-semibold text-heading">
              {inventoryField.name}
            </h2>
            <p className="inline-flex rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
              {t(`fields.types.${inventoryField.field_type}`)}
            </p>
            {inventoryField.is_required && (
              <span className="text-xs font-medium text-muted">
                {t("fields.settings.required")}
              </span>
            )}
            {!inventoryField.is_sortable && (
              <span className="text-xs text-muted">
                {t("fields.settings.notSortable")}
              </span>
            )}
          </div>
          {inventoryField.max_length !== null && (
            <p className="mt-1.5 text-xs text-muted">
              {t("fields.maximumLength", {
                length: inventoryField.max_length,
              })}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            className="rounded-lg border border-shell px-3 py-2 text-sm font-semibold transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isMutating}
            onClick={startEditing}
            type="button"
          >
            {t("common.actions.edit")}
          </button>

          <button
            className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger transition enabled:hover:bg-danger/25 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isMutating}
            onClick={handleDelete}
            type="button"
          >
            {t("common.actions.delete")}
          </button>
        </div>
      </div>

      {(inventoryField.field_type === "select" ||
        inventoryField.field_type === "multiselect") && (
        <InventoryFieldOptions
          fieldId={inventoryField.id}
          options={inventoryField.options}
        />
      )}
      {isDeleting && (
        <DeleteConfirmationDialog
          title={t("fields.titles.delete")}
          message={t("fields.confirmDelete", { name: inventoryField.name })}
          isPending={false}
          error={null}
          onClose={() => setIsDeleting(false)}
          onConfirm={() => {
            removeField(inventoryField.id);
            setIsDeleting(false);
          }}
        />
      )}
    </article>
  );
}
