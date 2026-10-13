import { type SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useDeleteInventoryItem,
  useUpdateInventoryItem,
} from "../hooks/useInventoryItems";
import { ApiError } from "../services/api";
import type {
  InventoryField,
  InventoryFieldOption,
} from "../types/inventoryField";
import type { InventoryItem, InventoryItemValue } from "../types/inventoryItem";
import { InventoryItemFieldInput } from "./InventoryItemCreateForm";
import { Modal } from "./Modal";
import {
  createValueInput,
  getInitialValue,
  type InventoryItemFormValue,
} from "./inventoryItemForm";

// Define properties for the inventory item table.
interface InventoryItemListProps {
  fields: InventoryField[];
  items: InventoryItem[];
}

/**
 * Return an option label for a stored option identifier.
 * @param options The available options for the field.
 * @param optionId The stored option identifier.
 * @returns The display label for the option.
 */
function getOptionLabel(
  options: InventoryFieldOption[],
  optionId: string,
): string {
  return options.find((option) => option.id === optionId)?.name ?? optionId;
}

/**
 * Format a stored value for display in the inventory table.
 * @param field The inventory field definition.
 * @param itemValue The stored value for the inventory item.
 * @param booleanLabels Labels to use for boolean values.
 * @returns A string suitable for display in the inventory table.
 */
function formatValue(
  field: InventoryField,
  itemValue: InventoryItemValue | undefined,
  booleanLabels: { no: string; yes: string },
): string {
  const value = itemValue?.value;

  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (field.field_type === "boolean" && typeof value === "boolean") {
    return value ? booleanLabels.yes : booleanLabels.no;
  }

  if (field.field_type === "select" && typeof value === "string") {
    return getOptionLabel(field.options, value);
  }

  if (field.field_type === "multiselect" && Array.isArray(value)) {
    return value
      .filter((optionId): optionId is string => typeof optionId === "string")
      .map((optionId) => getOptionLabel(field.options, optionId))
      .join(", ");
  }

  return String(value);
}

/**
 * Convert stored item values into editable form values.
 * @param fields The inventory fields defining the structure of the item.
 * @param item The inventory item containing stored values.
 * @returns A record mapping field IDs to editable form values.
 */
function getEditableValues(
  fields: InventoryField[],
  item: InventoryItem,
): Record<string, InventoryItemFormValue> {
  return Object.fromEntries(
    fields.map((field) => {
      const storedValue = item.values.find(
        (value) => value.field_id === field.id,
      )?.value;

      if (field.field_type === "boolean") {
        return [field.id, storedValue === true];
      }

      if (field.field_type === "multiselect") {
        return [
          field.id,
          Array.isArray(storedValue)
            ? storedValue.filter(
                (optionId): optionId is string => typeof optionId === "string",
              )
            : [],
        ];
      }

      return [
        field.id,
        storedValue === null || storedValue === undefined
          ? ""
          : String(storedValue),
      ];
    }),
  );
}

/**
 * Render active inventory items with editing and deletion actions.
 * @param fields The inventory fields defining the structure of the items.
 * @param items The list of inventory items to render.
 */
export function InventoryItemList({ fields, items }: InventoryItemListProps) {
  const { t } = useTranslation();
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<
    Record<string, InventoryItemFormValue>
  >({});
  const updateItem = useUpdateInventoryItem();
  const deleteItem = useDeleteInventoryItem();
  const isMutating = updateItem.isPending || deleteItem.isPending;
  const editingItem = items.find((item) => item.id === editingItemId);

  /**
   * Start editing the specified inventory item.
   * @param item The inventory item to edit.
   */
  function startEditing(item: InventoryItem) {
    setEditValues(getEditableValues(fields, item));
    setEditingItemId(item.id);
  }

  // Cancel editing the current inventory item.
  function cancelEditing() {
    setEditingItemId(null);
    setEditValues({});
  }

  /**
   * Handle the submission of the edit form for the current inventory item.
   * @param event The form submission event.
   */
  function handleUpdate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingItem) {
      return;
    }

    const values = fields.flatMap((field) => {
      const input = createValueInput(
        field,
        editValues[field.id] ?? getInitialValue(field),
      );

      return input ? [input] : [];
    });

    updateItem.mutate(
      {
        inventoryId: editingItem.inventory_id,
        itemId: editingItem.id,
        data: { values },
      },
      { onSuccess: cancelEditing },
    );
  }

  /**
   * Handle the deletion of an inventory item.
   * @param item The inventory item to delete.
   */
  function handleDelete(item: InventoryItem) {
    if (!window.confirm(t("items.confirmDelete"))) {
      return;
    }

    deleteItem.mutate({
      inventoryId: item.inventory_id,
      itemId: item.id,
    });
  }

  return (
    <>
      <div className="mt-8 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
              <tr>
                {fields.map((field) => (
                  <th
                    className="whitespace-nowrap border-b border-slate-200 px-4 py-3 dark:border-slate-700"
                    key={field.id}
                    scope="col"
                  >
                    {field.name}
                  </th>
                ))}
                <th
                  className="border-b border-slate-200 px-4 py-3 text-right dark:border-slate-700"
                  scope="col"
                >
                  {t("table.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {items.map((item) => {
                const valuesByField = new Map(
                  item.values.map((value) => [value.field_id, value]),
                );

                return (
                  <tr
                    className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    key={item.id}
                  >
                    {fields.map((field) => (
                      <td
                        className="max-w-80 px-4 py-3 align-top text-slate-700 dark:text-slate-200"
                        key={field.id}
                      >
                        <span className="line-clamp-3">
                          {formatValue(field, valuesByField.get(field.id), {
                            no: t("common.values.no"),
                            yes: t("common.values.yes"),
                          })}
                        </span>
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-4 py-3 text-right align-top">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
                          disabled={isMutating}
                          onClick={() => startEditing(item)}
                          type="button"
                        >
                          {t("common.actions.edit")}
                        </button>
                        <button
                          className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-500 dark:hover:bg-red-400"
                          disabled={isMutating}
                          onClick={() => handleDelete(item)}
                          type="button"
                        >
                          {deleteItem.isPending
                            ? t("common.actions.deleting")
                            : t("common.actions.delete")}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {deleteItem.error && (
          <p
            className="border-t border-slate-200 px-4 py-3 text-sm text-red-700 dark:border-slate-800 dark:text-red-300"
            role="alert"
          >
            {deleteItem.error instanceof ApiError
              ? deleteItem.error.message
              : t("items.errors.delete")}
          </p>
        )}
      </div>

      {editingItem && (
        <Modal
          onClose={() => {
            if (!isMutating) cancelEditing();
          }}
          title={t("items.titles.edit")}
        >
          <form onSubmit={handleUpdate}>
            <div className="grid gap-4 md:grid-cols-2">
              {fields.map((field) => (
                <InventoryItemFieldInput
                  disabled={isMutating}
                  field={field}
                  idPrefix={`edit-inventory-item-${editingItem.id}`}
                  key={field.id}
                  onChange={(value) =>
                    setEditValues((currentValues) => ({
                      ...currentValues,
                      [field.id]: value,
                    }))
                  }
                  value={editValues[field.id] ?? getInitialValue(field)}
                />
              ))}
            </div>

            {updateItem.error && (
              <p
                className="mt-4 text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {updateItem.error instanceof ApiError
                  ? updateItem.error.message
                  : t("items.errors.update")}
              </p>
            )}

            <div className="mt-5 flex gap-3">
              <button
                className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
                disabled={isMutating}
                type="submit"
              >
                {updateItem.isPending
                  ? t("common.actions.saving")
                  : t("common.actions.saveChanges")}
              </button>
              <button
                className="rounded-md border border-slate-300 px-4 py-2 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
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
    </>
  );
}
