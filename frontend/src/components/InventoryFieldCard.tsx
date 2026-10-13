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
    <article className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
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
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              id={`field-${inventoryField.id}-name`}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </div>

          <div className="flex gap-2">
            <button
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
              disabled={isMutating || !name.trim()}
              type="submit"
            >
              {updateInventoryField.isPending
                ? t("common.actions.saving")
                : t("common.actions.save")}
            </button>

            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
              disabled={isMutating}
              onClick={cancelEditing}
              type="button"
            >
              {t("common.actions.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-medium">{inventoryField.name}</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {t(`fields.types.${inventoryField.field_type}`)}
            </p>
            {inventoryField.max_length !== null && (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {t("fields.maximumLength", {
                  length: inventoryField.max_length,
                })}
              </p>
            )}
            {inventoryField.options.length > 0 && (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {t("fields.options", {
                  options: inventoryField.options
                    .map((option) => option.name)
                    .join(", "),
                })}
              </p>
            )}
          </div>

          <div className="flex shrink-0 gap-2">
            <button
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
              disabled={isMutating}
              onClick={startEditing}
              type="button"
            >
              {t("common.actions.edit")}
            </button>

            <button
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-500 dark:hover:bg-red-400"
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
        <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">
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
