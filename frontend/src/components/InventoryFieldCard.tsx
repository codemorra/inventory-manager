import { type SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useDeleteInventoryField,
  useUpdateInventoryField,
} from "../hooks/useInventoryFields";
import { ApiError } from "../services/api";
import type { InventoryField } from "../types/inventoryField";
import { InventoryFieldOptions } from "./InventoryFieldOptions";

// Define properties for an inventory field card.
interface InventoryFieldCardProps {
  inventoryId: string;
  inventoryField: InventoryField;
}

/**
 * Render inventory field details and management actions.
 * @param inventoryId The ID of the inventory to which the field belongs.
 * @param inventoryField The inventory field to display and manage.
 */
export function InventoryFieldCard({
  inventoryId,
  inventoryField,
}: InventoryFieldCardProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(inventoryField.name);

  const updateInventoryField = useUpdateInventoryField();
  const deleteInventoryField = useDeleteInventoryField();

  const isMutating =
    updateInventoryField.isPending || deleteInventoryField.isPending;
  const mutationError =
    updateInventoryField.error ?? deleteInventoryField.error;

  // Function to initiate editing of the inventory field.
  function startEditing() {
    setName(inventoryField.name);
    setIsEditing(true);
  }

  // Function to cancel editing of the inventory field.
  function cancelEditing() {
    setIsEditing(false);
  }

  // Function to handle the update of the inventory field.
  function handleUpdate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    updateInventoryField.mutate(
      {
        inventoryId,
        fieldId: inventoryField.id,
        data: {
          name: name.trim(),
        },
      },
      {
        onSuccess: () => {
          setIsEditing(false);
        },
      },
    );
  }

  // Function to handle the deletion of the inventory field.
  function handleDelete() {
    if (
      !window.confirm(t("fields.confirmDelete", { name: inventoryField.name }))
    ) {
      return;
    }

    deleteInventoryField.mutate({
      inventoryId,
      fieldId: inventoryField.id,
    });
  }

  return (
    <article className="rounded-2xl border border-shell bg-surface p-5 shadow-soft">
      {isEditing ? (
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={handleUpdate}
        >
          <div className="flex-1">
            <label
              className="sr-only"
              htmlFor={`field-${inventoryField.id}-name`}
            >
              {t("fields.form.fieldName")}
            </label>
            <input
              className="w-full rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              id={`field-${inventoryField.id}-name`}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </div>

          <div className="flex gap-2">
            <button
              className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-surface transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isMutating || !name.trim()}
              type="submit"
            >
              {updateInventoryField.isPending
                ? t("common.actions.saving")
                : t("common.actions.save")}
            </button>

            <button
              className="rounded-lg border border-shell px-3 py-2 text-sm font-semibold transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isMutating}
              onClick={cancelEditing}
              type="button"
            >
              {t("common.actions.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div>
            <h2 className="font-semibold text-foreground">
              {inventoryField.name}
            </h2>
            <p className="mt-2 inline-flex rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
              {t(`fields.types.${inventoryField.field_type}`)}
            </p>
            {inventoryField.max_length !== null && (
              <p className="mt-3 text-sm text-muted">
                {t("fields.maximumLength", {
                  length: inventoryField.max_length,
                })}
              </p>
            )}
            {inventoryField.options.length > 0 && (
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {t("fields.options", {
                  options: inventoryField.options
                    .map((option) => option.name)
                    .join(", "),
                })}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              className="rounded-lg border border-shell px-3 py-2 text-sm font-semibold transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isMutating}
              onClick={startEditing}
              type="button"
            >
              {t("common.actions.edit")}
            </button>

            <button
              className="rounded-lg bg-danger-soft px-3 py-2 text-sm font-semibold text-danger transition hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isMutating}
              onClick={handleDelete}
              type="button"
            >
              {deleteInventoryField.isPending
                ? t("common.actions.deleting")
                : t("common.actions.delete")}
            </button>
          </div>
        </div>
      )}

      {mutationError && (
        <p
          className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
          role="alert"
        >
          {mutationError instanceof ApiError
            ? mutationError.message
            : t("fields.errors.manage")}
        </p>
      )}

      {(inventoryField.field_type === "select" ||
        inventoryField.field_type === "multiselect") && (
        <InventoryFieldOptions
          fieldId={inventoryField.id}
          inventoryId={inventoryId}
          options={inventoryField.options}
        />
      )}
    </article>
  );
}
