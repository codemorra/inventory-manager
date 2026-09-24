import { type FormEvent, useState } from "react";

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

/** Define properties for the inventory item table. */
interface InventoryItemListProps {
  fields: InventoryField[];
  items: InventoryItem[];
}

/** Return an option label for a stored option identifier. */
function getOptionLabel(
  options: InventoryFieldOption[],
  optionId: string,
): string {
  return options.find((option) => option.id === optionId)?.name ?? optionId;
}

/** Format a stored value for display in the inventory table. */
function formatValue(
  field: InventoryField,
  itemValue: InventoryItemValue | undefined,
): string {
  const value = itemValue?.value;

  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (field.field_type === "boolean" && typeof value === "boolean") {
    return value ? "Yes" : "No";
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

/** Convert stored item values into editable form values. */
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

/** Render active inventory items with editing and deletion actions. */
export function InventoryItemList({ fields, items }: InventoryItemListProps) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<
    Record<string, InventoryItemFormValue>
  >({});
  const updateItem = useUpdateInventoryItem();
  const deleteItem = useDeleteInventoryItem();
  const isMutating = updateItem.isPending || deleteItem.isPending;
  const editingItem = items.find((item) => item.id === editingItemId);

  function startEditing(item: InventoryItem) {
    setEditValues(getEditableValues(fields, item));
    setEditingItemId(item.id);
  }

  function cancelEditing() {
    setEditingItemId(null);
    setEditValues({});
  }

  function handleUpdate(event: FormEvent<HTMLFormElement>) {
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

  function handleDelete(item: InventoryItem) {
    if (!window.confirm("Delete this inventory item?")) {
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
                  Actions
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
                          {formatValue(field, valuesByField.get(field.id))}
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
                          Edit
                        </button>
                        <button
                          className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-500 dark:hover:bg-red-400"
                          disabled={isMutating}
                          onClick={() => handleDelete(item)}
                          type="button"
                        >
                          {deleteItem.isPending ? "Deleting…" : "Delete"}
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
              : "Unable to delete inventory item."}
          </p>
        )}
      </div>

      {editingItem && (
        <Modal
          onClose={() => {
            if (!isMutating) cancelEditing();
          }}
          title="Edit inventory item"
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
                  : "Unable to update inventory item."}
              </p>
            )}

            <div className="mt-5 flex gap-3">
              <button
                className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
                disabled={isMutating}
                type="submit"
              >
                {updateItem.isPending ? "Saving…" : "Save changes"}
              </button>
              <button
                className="rounded-md border border-slate-300 px-4 py-2 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
                disabled={isMutating}
                onClick={cancelEditing}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
