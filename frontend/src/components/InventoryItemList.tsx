import { type ReactNode, type SyntheticEvent, useState } from "react";
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
import { sortInventoryItems, type ItemSort } from "./inventoryItemSorting";
import {
  createValueInput,
  getInitialValue,
  type InventoryItemFormValue,
} from "./inventoryItemForm";

// Define properties for the inventory item table.
interface InventoryItemListProps {
  fields: InventoryField[];
  items: InventoryItem[];
  actions?: ReactNode;
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
 * @param actions Optional controls displayed in the table toolbar.
 * @returns The inventory item table and edit modal.
 */
export function InventoryItemList({
  fields,
  items,
  actions,
}: InventoryItemListProps) {
  const { t, i18n } = useTranslation();
  const [sort, setSort] = useState<ItemSort | null>(null);
  const sortField = fields.find((field) => field.id === sort?.fieldId);
  const displayedItems =
    sort && sortField
      ? sortInventoryItems(
          items,
          sortField,
          sort.direction,
          i18n.resolvedLanguage ?? "en",
        )
      : items;
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<
    Record<string, InventoryItemFormValue>
  >({});
  const updateItem = useUpdateInventoryItem();
  const deleteItem = useDeleteInventoryItem();
  const isMutating = updateItem.isPending || deleteItem.isPending;
  const editingItem = items.find((item) => item.id === editingItemId);

  /**
   * Sort a column ascending initially and toggle its direction on subsequent clicks.
   * @param fieldId The identifier of the selected column.
   */
  function toggleSort(fieldId: string) {
    setSort((current) => ({
      fieldId,
      direction:
        current?.fieldId === fieldId && current.direction === "ascending"
          ? "descending"
          : "ascending",
    }));
  }

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
      <div className="overflow-hidden rounded-md border border-shell bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-shell px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm font-medium text-muted">
              {t("items.count", { count: items.length })}
            </p>
            {sort && sortField && (
              <button
                className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => setSort(null)}
                type="button"
              >
                {t("table.resetSort")}
              </button>
            )}
          </div>
          {actions}
        </div>
        <div
          className="overflow-x-auto"
          role="region"
          aria-label={t("items.title")}
          tabIndex={0}
        >
          <table className="min-w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t("table.sortHint")}</caption>
            <thead className="bg-surface-muted text-xs font-semibold uppercase tracking-wider text-muted">
              <tr>
                {fields.map((field) => (
                  <th
                    aria-sort={
                      sort?.fieldId === field.id ? sort.direction : undefined
                    }
                    className="whitespace-nowrap border-b border-shell p-0"
                    key={field.id}
                    scope="col"
                  >
                    <button
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left font-semibold transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${sort?.fieldId === field.id ? "bg-accent-soft text-accent" : ""}`}
                      onClick={() => toggleSort(field.id)}
                      type="button"
                    >
                      <span>{field.name}</span>
                      <svg
                        aria-hidden="true"
                        className="size-3.5 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        viewBox="0 0 16 16"
                      >
                        {sort?.fieldId === field.id ? (
                          <path
                            d={
                              sort.direction === "ascending"
                                ? "M8 13V3m-4 4 4-4 4 4"
                                : "M8 3v10m-4-4 4 4 4-4"
                            }
                          />
                        ) : (
                          <path d="m3 6 3-3 3 3M7 10l3 3 3-3" />
                        )}
                      </svg>
                    </button>
                  </th>
                ))}
                <th
                  className="sticky right-0 w-px whitespace-nowrap border-b border-l border-shell bg-surface-muted px-4 py-3 text-right"
                  scope="col"
                >
                  {t("table.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-shell">
              {displayedItems.map((item) => {
                const valuesByField = new Map(
                  item.values.map((value) => [value.field_id, value]),
                );

                return (
                  <tr className="group" key={item.id}>
                    {fields.map((field) => (
                      <td
                        className="max-w-80 border-r border-shell/60 px-4 py-2.5 align-top text-foreground transition-colors group-hover:bg-surface-hover"
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
                    <td className="sticky right-0 whitespace-nowrap border-l border-shell bg-surface px-4 py-2.5 text-right align-top transition-colors group-hover:bg-surface-hover">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-md border border-shell px-2.5 py-1 font-medium transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isMutating}
                          onClick={() => startEditing(item)}
                          type="button"
                        >
                          {t("common.actions.edit")}
                        </button>
                        <button
                          className="rounded-md bg-danger-soft px-2.5 py-1 font-medium text-danger transition hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-50"
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
              {items.length === 0 && (
                <tr>
                  <td
                    className="px-6 py-12 text-center"
                    colSpan={fields.length + 1}
                  >
                    <p className="font-semibold text-heading">
                      {t("items.empty")}
                    </p>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                      {t("items.emptyDescription")}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {deleteItem.error && (
          <p
            className="border-t border-shell bg-danger-soft px-5 py-3 text-sm text-danger"
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
                className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
                role="alert"
              >
                {updateItem.error instanceof ApiError
                  ? updateItem.error.message
                  : t("items.errors.update")}
              </p>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isMutating}
                type="submit"
              >
                {updateItem.isPending
                  ? t("common.actions.saving")
                  : t("common.actions.saveChanges")}
              </button>
              <button
                className="rounded-lg border border-shell px-4 py-2.5 text-sm font-semibold transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
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
