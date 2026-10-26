import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";
import { type ReactNode, type SyntheticEvent, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  useDeleteInventoryItem,
  useUpdateInventoryItem,
  useReloadInventoryItems,
} from "../hooks/useInventoryItems";
import { ApiError } from "../services/api";
import type {
  InventoryField,
  InventoryFieldOption,
} from "../types/inventoryField";
import type { InventoryItem, InventoryItemValue } from "../types/inventoryItem";
import { InventoryItemFieldInput } from "./InventoryItemCreateForm";
import { Modal } from "./Modal";
import { formatDuration } from "./duration";
import { isUrlInput, isWebAddress, urlDisplayText } from "./url";
import { InventoryTableControls } from "./InventoryTableControls";
import { sortInventoryItems, type ItemSort } from "./inventoryItemSorting";
import {
  createValueInput,
  createCheckboxReplacement,
  getInitialValue,
  hasValidItemValues,
  getEditableValue,
  type InventoryItemFormValue,
} from "./inventoryItemForm";

// Define properties for the inventory item table.
interface InventoryItemListProps {
  fields: InventoryField[];
  items: InventoryItem[];
  actions?: ReactNode;
}

/**
 * Identify stale or deleted item snapshots that cannot safely be retried unchanged.
 * @param error The failed item request.
 * @returns Whether explicit reloading is required before another write.
 */
function isItemConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    [
      "inventory_item_conflict",
      "inventory_item_not_found",
      "inventory_not_found",
    ].includes(error.code ?? "")
  );
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
 * @param locale The language used to format duration hours.
 * @returns A readable table value or a safe external link.
 */
function formatValue(
  field: InventoryField,
  itemValue: InventoryItemValue | undefined,
  booleanLabels: { no: string; yes: string },
  locale: string,
): ReactNode {
  const value = itemValue?.value;
  if (field.field_type === "url") {
    if (!isUrlInput(value)) return "—";
    const text = urlDisplayText(value) || "—";
    // Treat malformed legacy destinations as plain text; never make unsupported schemes clickable.
    if (!isWebAddress(value.url)) return text;
    return (
      <a
        href={value.url}
        target="_blank"
        rel="noopener noreferrer"
        title={value.url}
        className="cursor-pointer break-all text-accent underline decoration-accent/40 underline-offset-2 transition hover:text-accent-hover hover:decoration-current focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {text}
      </a>
    );
  }

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

  if (field.field_type === "duration" && typeof value === "number")
    return formatDuration(value, locale);

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

      return [field.id, getEditableValue(field, storedValue)];
    }),
  );
}

/**
 * Render active inventory items with editing and deletion actions.
 * @param fields The inventory fields defining the structure of the items.
 * @param items The list of inventory items to render.
 * @param actions Optional controls displayed in the table toolbar.
 * @returns The inventory item table and its management dialogs.
 */
export function InventoryItemList({
  fields,
  items,
  actions,
}: InventoryItemListProps) {
  const [deletingTarget, setDeletingTarget] = useState<InventoryItem | null>(
    null,
  );
  const { t, i18n } = useTranslation();
  const [sort, setSort] = useState<ItemSort | null>(null);
  const [wrapText, setWrapText] = useState(true);
  const sortField = fields.find(
    (field) => field.id === sort?.fieldId && field.is_sortable,
  );
  const displayedItems =
    sort && sortField
      ? sortInventoryItems(
          items,
          sortField,
          sort.direction,
          i18n.resolvedLanguage ?? "en",
        )
      : items;
  // Retain the original item revision even when background refreshes replace the table data.
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const editingItemId = editingItem?.id ?? null;
  const [reloadMissing, setReloadMissing] = useState(false);
  const [editValues, setEditValues] = useState<
    Record<string, InventoryItemFormValue>
  >({});
  const updateItem = useUpdateInventoryItem();
  const checkboxUpdate = useUpdateInventoryItem();
  const checkboxInFlight = useRef(false);
  const [checkboxEditHint, setCheckboxEditHint] = useState(false);
  const [checkboxTarget, setCheckboxTarget] = useState<{
    inventoryId: string;
    itemId: string;
    fieldId: string;
  } | null>(null);
  const deleteItem = useDeleteInventoryItem();
  const reloadItems = useReloadInventoryItems();
  const isMutating =
    updateItem.isPending ||
    deleteItem.isPending ||
    checkboxUpdate.isPending ||
    reloadItems.isPending;
  const editConflict = isItemConflict(updateItem.error);
  const checkboxConflict = isItemConflict(checkboxUpdate.error);
  const deleteConflict = isItemConflict(deleteItem.error);
  const recoveryClass =
    "rounded-md border border-shell px-3 py-2 text-sm font-medium transition enabled:hover:bg-control-hover disabled:opacity-50";

  /**
   * Cycle a column through ascending, descending, and the original item order.
   * @param fieldId The identifier of the selected column.
   */
  function toggleSort(fieldId: string) {
    if (!fields.some((field) => field.id === fieldId && field.is_sortable))
      return;
    setSort((current) => {
      if (current?.fieldId !== fieldId)
        return { fieldId, direction: "ascending" };
      return current.direction === "ascending"
        ? { fieldId, direction: "descending" }
        : null;
    });
  }

  /**
   * Start editing the specified inventory item.
   * @param item The inventory item to edit.
   */
  function startEditing(item: InventoryItem) {
    updateItem.reset();
    reloadItems.reset();
    setReloadMissing(false);
    checkboxUpdate.reset();
    setCheckboxEditHint(false);
    setEditValues(getEditableValues(fields, item));
    setEditingItem(item);
  }

  // Cancel editing the current inventory item.
  function cancelEditing() {
    setCheckboxEditHint(false);
    setEditingItem(null);
    setEditValues({});
  }

  /**
   * Save a table checkbox while preserving the full-replacement and required-field contracts.
   * @param item The saved item whose checkbox was clicked.
   * @param field The checkbox field to change.
   * @param checked The new state requested by the user.
   */
  function toggleCheckbox(
    item: InventoryItem,
    field: InventoryField,
    checked: boolean,
  ) {
    if (
      isMutating ||
      checkboxInFlight.current ||
      editingItemId !== null ||
      deletingTarget !== null
    )
      return;
    checkboxUpdate.reset();
    const values = { ...getEditableValues(fields, item), [field.id]: checked };
    if (!hasValidItemValues(fields, values)) {
      // A table shortcut cannot bypass requirements introduced after this item was created.
      startEditing(item);
      setEditValues(values);
      setCheckboxEditHint(true);
      return;
    }
    setCheckboxTarget({
      inventoryId: item.inventory_id,
      itemId: item.id,
      fieldId: field.id,
    });
    // Block rapid consecutive toggles until persistence and the item query refresh have both finished.
    checkboxInFlight.current = true;
    checkboxUpdate.mutate(
      {
        inventoryId: item.inventory_id,
        itemId: item.id,
        data: createCheckboxReplacement(fields, item, field.id, checked),
      },
      {
        onSettled: () => {
          checkboxInFlight.current = false;
        },
      },
    );
  }

  /**
   * Handle the submission of the edit form for the current inventory item.
   * @param event The form submission event.
   */
  function handleUpdate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !editingItem ||
      isMutating ||
      editConflict ||
      reloadMissing ||
      !hasValidItemValues(fields, editValues)
    ) {
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
        data: { values, expected_revision: editingItem.revision },
      },
      { onSuccess: cancelEditing },
    );
  }

  /**
   * Ask for confirmation before deleting the selected item.
   * @param item The item selected for deletion.
   */
  function handleDelete(item: InventoryItem) {
    reloadItems.reset();
    deleteItem.reset();
    setDeletingTarget(item);
  }

  // Explicitly discard the local draft only after a successful refresh retrieves its current item.
  function reloadEdit() {
    if (!editingItem || isMutating) return;
    reloadItems.mutate(editingItem.inventory_id, {
      onSuccess: (fresh) => {
        const item = fresh.find((entry) => entry.id === editingItem.id);
        if (item) startEditing(item);
        else setReloadMissing(true);
      },
    });
  }

  return (
    <>
      {checkboxConflict && (
        <div
          role="alert"
          className="mb-4 space-y-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
        >
          <p>{t("items.conflict.checkbox")}</p>
          <button
            className={recoveryClass}
            disabled={isMutating}
            type="button"
            onClick={() => {
              if (!checkboxTarget) return;
              reloadItems.mutate(checkboxTarget.inventoryId, {
                onSuccess: () => checkboxUpdate.reset(),
              });
            }}
          >
            {t("items.conflict.reloadList")}
          </button>
        </div>
      )}
      {reloadItems.error && !editingItem && !deletingTarget && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {t("items.conflict.reloadFailed")}
        </p>
      )}
      <InventoryTableControls
        itemCount={items.length}
        actions={actions}
        wrapText={wrapText}
        onWrapTextChange={setWrapText}
        disabled={isMutating || editingItem !== null || deletingTarget !== null}
      />
      <div className="overflow-hidden rounded-b-md border border-shell bg-surface">
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
                      sortField?.id === field.id ? sort?.direction : undefined
                    }
                    className="whitespace-nowrap border-b border-shell p-0"
                    key={field.id}
                    scope="col"
                  >
                    {field.is_sortable ? (
                      <button
                        className={`flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left font-semibold transition-colors enabled:hover:bg-control-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${sortField?.id === field.id ? "bg-accent-soft text-accent" : ""}`}
                        onClick={() => toggleSort(field.id)}
                        type="button"
                      >
                        <span>{field.name}</span>
                        {/* Reserve the indicator space so sorting never shifts the heading. */}
                        <span
                          aria-hidden="true"
                          className="ml-auto flex size-3.5 shrink-0 items-center justify-center"
                        >
                          {sortField?.id === field.id && sort && (
                            <svg
                              className="size-3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth="1.8"
                              viewBox="0 0 16 16"
                            >
                              <path
                                d={
                                  sort.direction === "ascending"
                                    ? "m4 10 4-4 4 4"
                                    : "m4 6 4 4 4-4"
                                }
                              />
                            </svg>
                          )}
                        </span>
                      </button>
                    ) : (
                      <span className="block px-4 py-3">{field.name}</span>
                    )}
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
                        {field.field_type === "checkbox" ? (
                          <div className="min-h-6">
                            <input
                              type="checkbox"
                              className="size-4 cursor-pointer accent-accent transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
                              aria-label={t("items.checkbox.toggle", {
                                field: field.name,
                              })}
                              aria-busy={
                                (checkboxUpdate.isPending &&
                                  checkboxTarget?.itemId === item.id &&
                                  checkboxTarget.fieldId === field.id) ||
                                undefined
                              }
                              checked={
                                checkboxUpdate.isPending &&
                                checkboxTarget?.itemId === item.id &&
                                checkboxTarget.fieldId === field.id
                                  ? checkboxUpdate.variables?.data.values.find(
                                      (value) => value.field_id === field.id,
                                    )?.value === true
                                  : valuesByField.get(field.id)?.value === true
                              }
                              disabled={
                                isMutating ||
                                checkboxConflict ||
                                editingItemId !== null ||
                                deletingTarget !== null
                              }
                              onChange={(event) =>
                                toggleCheckbox(
                                  item,
                                  field,
                                  event.target.checked,
                                )
                              }
                            />
                            {checkboxUpdate.error &&
                              !checkboxConflict &&
                              checkboxTarget?.itemId === item.id &&
                              checkboxTarget.fieldId === field.id && (
                                <p
                                  className="mt-1 text-xs text-danger"
                                  role="alert"
                                >
                                  {checkboxUpdate.error instanceof ApiError
                                    ? checkboxUpdate.error.message
                                    : t("items.errors.update")}
                                </p>
                              )}
                          </div>
                        ) : (
                          <span
                            className={
                              wrapText
                                ? "line-clamp-3 max-w-80 whitespace-pre-wrap wrap-break-word"
                                : "block max-w-80 truncate"
                            }
                          >
                            {formatValue(
                              field,
                              valuesByField.get(field.id),
                              {
                                no: t("common.values.no"),
                                yes: t("common.values.yes"),
                              },
                              i18n.resolvedLanguage ?? "en",
                            )}
                          </span>
                        )}
                      </td>
                    ))}
                    <td className="sticky right-0 whitespace-nowrap border-l border-shell bg-surface px-4 py-2.5 text-right align-top transition-colors group-hover:bg-surface-hover">
                      <div className="flex justify-end gap-2">
                        <button
                          className="rounded-md border border-shell px-2.5 py-1 font-medium transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isMutating}
                          onClick={() => startEditing(item)}
                          type="button"
                        >
                          {t("common.actions.edit")}
                        </button>
                        <button
                          className="rounded-md bg-danger-soft px-2.5 py-1 font-medium text-danger transition enabled:hover:bg-danger/25 disabled:cursor-not-allowed disabled:opacity-50"
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
      </div>

      {editingItem && (
        <Modal
          onClose={() => {
            if (!isMutating) cancelEditing();
          }}
          title={t("items.titles.edit")}
        >
          <form onSubmit={handleUpdate}>
            {checkboxEditHint && (
              <p className="mb-4 text-sm text-muted" role="status">
                {t("items.checkbox.completeRequired")}
              </p>
            )}
            {fields.some((field) => field.is_required) && (
              <p className="mb-4 text-xs text-muted">
                {t("items.requiredHint")}
              </p>
            )}
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
                {editConflict
                  ? t("items.conflict.edit")
                  : updateItem.error instanceof ApiError
                    ? updateItem.error.message
                    : t("items.errors.update")}
              </p>
            )}
            {editConflict && (
              <button
                className={`${recoveryClass} mt-3`}
                type="button"
                disabled={isMutating}
                onClick={reloadEdit}
              >
                {t("items.conflict.discardAndReload")}
              </button>
            )}
            {reloadMissing && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {t("items.conflict.deleted")}
              </p>
            )}
            {reloadItems.error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {t("items.conflict.reloadFailed")}
              </p>
            )}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition enabled:hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={
                  isMutating ||
                  editConflict ||
                  reloadMissing ||
                  !hasValidItemValues(fields, editValues)
                }
                type="submit"
              >
                {updateItem.isPending
                  ? t("common.actions.saving")
                  : t("common.actions.saveChanges")}
              </button>
              <button
                className="rounded-lg border border-shell px-4 py-2.5 text-sm font-semibold transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
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
      {deletingTarget && (
        <DeleteConfirmationDialog
          title={t("items.titles.delete")}
          message={t("items.confirmDelete")}
          isPending={deleteItem.isPending || reloadItems.isPending}
          confirmDisabled={deleteConflict}
          error={
            deleteItem.error
              ? deleteConflict
                ? t("items.conflict.delete")
                : deleteItem.error instanceof ApiError
                  ? deleteItem.error.message
                  : t("items.errors.delete")
              : null
          }
          onClose={() => setDeletingTarget(null)}
          onConfirm={() =>
            deleteItem.mutate(
              {
                inventoryId: deletingTarget.inventory_id,
                itemId: deletingTarget.id,
                expectedRevision: deletingTarget.revision,
              },
              { onSuccess: () => setDeletingTarget(null) },
            )
          }
        >
          {deleteConflict && (
            <button
              className={recoveryClass}
              type="button"
              disabled={isMutating}
              onClick={() => {
                reloadItems.mutate(deletingTarget.inventory_id, {
                  onSuccess: (fresh) => {
                    setDeletingTarget(
                      fresh.find((entry) => entry.id === deletingTarget.id) ??
                        null,
                    );
                    deleteItem.reset();
                  },
                });
              }}
            >
              {t("items.conflict.reloadItem")}
            </button>
          )}
          {reloadItems.error && (
            <p role="alert" className="text-sm text-danger">
              {t("items.conflict.reloadFailed")}
            </p>
          )}
        </DeleteConfirmationDialog>
      )}
    </>
  );
}
