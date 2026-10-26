import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";
import {
  type ReactNode,
  type SyntheticEvent,
  useId,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import {
  useDeleteInventoryItem,
  useUpdateInventoryItem,
  useReloadInventoryItems,
} from "../hooks/useInventoryItems";
import { ApiError } from "../services/api";
import { useInventoryView } from "../hooks/useInventoryView";
import { useAutomaticColumnWidths } from "../hooks/useAutomaticColumnWidths";
import { useTableRowHeights } from "../hooks/useTableRowHeights";
import { distributeColumnWidths } from "../appearance/inventoryColumns";
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
import { ColumnResizeHandle } from "./ColumnResizeHandle";
import { ContextMenu } from "./ContextMenu";
import { sortInventoryItems } from "./inventoryItemSorting";
import { searchInventoryItems } from "./inventoryItemSearch";
import { filterInventoryItems, itemFilterError } from "./inventoryItemFilters";
import { InventoryItemFilters } from "./InventoryItemFilters";
import { InventoryTableCellInput } from "./InventoryTableCellInput";
import { getTableCellValue } from "./inventoryTableDraft";
import { useInventoryTableEdit } from "../hooks/useInventoryTableEdit";
import { TableEditSessionContext } from "./tableEditSession";
import { UnsavedTableChanges } from "./UnsavedTableChanges";
import type { ItemFilter } from "../types/itemFilter";
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
  inventoryId: string;
  fields: InventoryField[];
  items: InventoryItem[];
  actions?: ReactNode;
}

// Keep the column menu anchored to the cursor and restore focus to its source.
interface ColumnMenuTarget {
  fieldId: string;
  x: number;
  y: number;
  source: HTMLElement;
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
 * @param inventoryId The inventory whose table view is persisted.
 * @param fields The inventory fields defining the structure of the items.
 * @param items The list of inventory items to render.
 * @param actions Optional controls displayed in the table toolbar.
 * @returns The inventory item table and its management dialogs.
 */
export function InventoryItemList({
  inventoryId,
  fields: currentFields,
  items: currentItems,
  actions,
}: InventoryItemListProps) {
  const [deletingTarget, setDeletingTarget] = useState<InventoryItem | null>(
    null,
  );
  const { t, i18n } = useTranslation();
  const tableEdit = useInventoryTableEdit(inventoryId);
  const fields = tableEdit.draft?.fields ?? currentFields;
  const items = tableEdit.draft?.items ?? currentItems;
  const { setInventoryId: setEditingInventoryId } = useContext(
    TableEditSessionContext,
  );
  useEffect(() => {
    if (!tableEdit.active) return;
    setEditingInventoryId(inventoryId);
    return () =>
      setEditingInventoryId((current) =>
        current === inventoryId ? null : current,
      );
  }, [tableEdit.active, inventoryId, setEditingInventoryId]);
  const {
    view: currentView,
    toggleSort,
    toggleField,
    setWrapText,
    setColumnWidth,
    setAutomaticColumnWidth,
  } = useInventoryView(inventoryId, fields);
  const view = tableEdit.draft?.presentation.view ?? currentView;
  const { sort, wrapText, hiddenFieldIds } = view;
  const visibleFields = fields.filter(
    (field) => !hiddenFieldIds.includes(field.id),
  );
  const [resizing, setResizing] = useState<{
    fieldId: string;
    width: number;
  } | null>(null);
  const [columnMenu, setColumnMenu] = useState<ColumnMenuTarget | null>(null);
  const dataTable = useRef<HTMLTableElement>(null);
  const dataViewport = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  useLayoutEffect(() => {
    const element = dataViewport.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailableWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const tableId = useId();
  const previouslyEditing = useRef(false);
  useEffect(() => {
    if (previouslyEditing.current && !tableEdit.active)
      document.getElementById(`${tableId}-edit`)?.focus();
    previouslyEditing.current = tableEdit.active;
  }, [tableEdit.active, tableId]);
  const currentLocale = i18n.resolvedLanguage ?? "en";
  const locale = tableEdit.draft?.presentation.locale ?? currentLocale;
  const noLabel =
    tableEdit.draft?.presentation.booleanLabels.no ?? t("common.values.no");
  const yesLabel =
    tableEdit.draft?.presentation.booleanLabels.yes ?? t("common.values.yes");
  const [searchQuery, setSearchQuery] = useState("");
  const [filters, setFilters] = useState<ItemFilter[]>([]);
  const activeFilters = useMemo(
    () =>
      (tableEdit.draft?.presentation.filters ?? filters).filter(
        (filter) => !itemFilterError(filter, fields),
      ),
    [tableEdit.draft?.presentation.filters, filters, fields],
  );
  const matchingItems = useMemo(
    () =>
      filterInventoryItems(
        searchInventoryItems(
          items,
          fields,
          searchQuery,
          { no: noLabel, yes: yesLabel },
          locale,
        ),
        fields,
        activeFilters,
        locale,
      ),
    [items, fields, searchQuery, activeFilters, locale, noLabel, yesLabel],
  );
  // Measure every loaded value so filtering never makes automatic columns jump.
  const columnContents = useMemo(
    () =>
      fields.map((field) => ({
        field,
        values: items.map((item) => {
          const stored = item.values.find(
            (value) => value.field_id === field.id,
          );
          const value = stored?.value;
          const content = formatValue(
            field,
            stored,
            { no: noLabel, yes: yesLabel },
            locale,
          );
          return typeof content === "string"
            ? content
            : isUrlInput(value)
              ? urlDisplayText(value)
              : "";
        }),
      })),
    [fields, items, locale, noLabel, yesLabel],
  );
  const automaticWidths = useAutomaticColumnWidths(
    columnContents,
    dataTable,
    visibleFields.map((field) => field.id).join(","),
  );
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  // The preview is a draft manual override; neither Auto flags nor surplus are persisted.
  const manualWidths = resizing
    ? { ...view.columnWidths, [resizing.fieldId]: resizing.width }
    : view.columnWidths;
  const baseColumns = visibleFields.map((field) => ({
    field,
    // Editing may need wider controls, but never saves this temporary width as a preference.
    width: Math.max(
      manualWidths[field.id] ?? automaticWidths[field.id],
      tableEdit.draft && field.field_type !== "id"
        ? ({ url: 240, duration: 240, datetime: 200, date: 150, time: 135 }[
            field.field_type as
              "url" | "duration" | "datetime" | "date" | "time"
          ] ?? 140)
        : 0,
    ),
  }));
  const displayWidths = distributeColumnWidths(
    baseColumns.map((column) => column.width),
    availableWidth,
    baseColumns.map(({ field }) => manualWidths[field.id] === undefined),
  );
  const visibleColumns = baseColumns.map(
    ({ field, width: baseWidth }, index) => ({
      field,
      baseWidth,
      width: displayWidths[index],
    }),
  );
  const tableWidth = displayWidths.reduce((total, width) => total + width, 0);
  const allVisibleColumnsAutomatic = visibleFields.every(
    (field) => view.columnWidths[field.id] === undefined,
  );
  const sortField = fields.find(
    (field) => field.id === sort?.fieldId && field.is_sortable,
  );
  const sortedItems = useMemo(
    () =>
      sort && sortField
        ? sortInventoryItems(matchingItems, sortField, sort.direction, locale)
        : matchingItems,
    [matchingItems, sort, sortField, locale],
  );
  const displayedItems = tableEdit.draft?.displayedItems ?? sortedItems;
  // Explicit reload starts a fresh session; deferred storage/language changes apply to that new baseline.
  function beginTableEditing() {
    tableEdit.begin({
      view: currentView,
      searchQuery,
      filters,
      locale: currentLocale,
      booleanLabels: { no: t("common.values.no"), yes: t("common.values.yes") },
    });
  }
  const rowHeights = useTableRowHeights(dataTable, displayedItems);
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
    tableEdit.loading ||
    tableEdit.saving ||
    updateItem.isPending ||
    deleteItem.isPending ||
    checkboxUpdate.isPending ||
    reloadItems.isPending;
  const controlsDisabled =
    tableEdit.active ||
    isMutating ||
    editingItem !== null ||
    deletingTarget !== null ||
    resizing !== null;
  const menuField = columnMenu
    ? visibleFields.find((field) => field.id === columnMenu.fieldId)
    : undefined;
  if (columnMenu && !menuField) setColumnMenu(null);

  /**
   * Open the column settings at the pointer, or below the header for keyboard access.
   * @param fieldId The column whose settings are requested.
   * @param header The header element anchoring keyboard invocation.
   * @param x The pointer's horizontal viewport position.
   * @param y The pointer's vertical viewport position.
   * @param source The focused keyboard control, if the menu was keyboard-invoked.
   */
  function openColumnMenu(
    fieldId: string,
    header: HTMLTableCellElement,
    x: number,
    y: number,
    source?: HTMLElement,
  ) {
    if (
      tableEdit.active ||
      isMutating ||
      editingItem !== null ||
      deletingTarget !== null ||
      resizing !== null
    )
      return;
    const bounds = header.getBoundingClientRect();
    setColumnMenu({
      fieldId,
      x: x === 0 && y === 0 ? bounds.left : x,
      y: x === 0 && y === 0 ? bounds.bottom : y,
      source:
        source ??
        header.querySelector<HTMLElement>('button, [tabindex="0"]') ??
        header,
    });
  }

  // Restore focus when closing settings without hiding their source column.
  function closeColumnMenu() {
    setColumnMenu(null);
    if (columnMenu?.source.isConnected) columnMenu.source.focus();
    else dataViewport.current?.focus();
  }
  const editConflict = isItemConflict(updateItem.error);
  const checkboxConflict = isItemConflict(checkboxUpdate.error);
  const deleteConflict = isItemConflict(deleteItem.error);
  const recoveryClass =
    "rounded-md border border-shell px-3 py-2 text-sm font-medium transition enabled:hover:bg-control-hover disabled:opacity-50";

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
      <UnsavedTableChanges
        dirty={tableEdit.dirty}
        saving={tableEdit.saving}
        onDiscard={tableEdit.cancel}
      />
      {tableEdit.error && (
        <div
          role="alert"
          className="mb-3 space-y-2 rounded-sm border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
        >
          <p>
            {t(
              tableEdit.conflict
                ? "table.edit.conflict"
                : tableEdit.draft
                  ? "table.edit.saveFailed"
                  : "table.edit.loadFailed",
            )}
          </p>
          {tableEdit.conflict && (
            <button
              type="button"
              className={recoveryClass}
              disabled={tableEdit.loading || tableEdit.saving}
              onClick={beginTableEditing}
            >
              {t("items.conflict.discardAndReload")}
            </button>
          )}
        </div>
      )}
      {tableEdit.errors.length > 0 && (
        <div
          role="alert"
          className="mb-3 rounded-sm border border-danger/30 bg-danger-soft p-3 text-sm text-danger"
        >
          <p>{t("table.edit.correctErrors")}</p>
          {[
            ...new Set(
              tableEdit.errors
                .filter((error) => hiddenFieldIds.includes(error.fieldId))
                .map((error) => error.fieldId),
            ),
          ].map((fieldId) => (
            <button
              key={fieldId}
              type="button"
              className="mt-2 mr-2 rounded-sm border border-shell px-2 py-1"
              onClick={() => tableEdit.showField(fieldId)}
            >
              {t("table.edit.showField", {
                field: fields.find((field) => field.id === fieldId)?.name,
              })}
            </button>
          ))}
        </div>
      )}
      <InventoryTableControls
        columns={fields.map((field) => ({
          id: field.id,
          name: field.name,
          visible: !hiddenFieldIds.includes(field.id),
        }))}
        onToggleColumn={toggleField}
        onAutomaticWidths={() => setAutomaticColumnWidth()}
        allColumnsAutomatic={allVisibleColumnsAutomatic}
        itemCount={displayedItems.length}
        totalItemCount={
          searchQuery.trim() || activeFilters.length ? items.length : undefined
        }
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        filterControl={
          <InventoryItemFilters
            fields={fields}
            filters={activeFilters}
            onApply={setFilters}
            disabled={controlsDisabled}
          />
        }
        actions={
          <>
            {tableEdit.draft ? (
              <>
                <span
                  className="text-xs text-muted"
                  title={t("table.edit.stableView")}
                >
                  {t("table.edit.changedCount", {
                    count: tableEdit.changedCount,
                  })}
                </span>
                <button
                  type="button"
                  className="rounded-sm border border-shell px-2.5 py-1.5 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
                  disabled={tableEdit.loading || tableEdit.saving}
                  onClick={tableEdit.cancel}
                >
                  {t("common.actions.cancel")}
                </button>
                <button
                  type="button"
                  className="rounded-sm bg-accent px-2.5 py-1.5 text-sm font-semibold text-surface enabled:hover:bg-accent-hover disabled:opacity-50"
                  disabled={
                    tableEdit.loading ||
                    tableEdit.saving ||
                    tableEdit.conflict ||
                    !tableEdit.dirty ||
                    tableEdit.errors.length > 0
                  }
                  onClick={tableEdit.commit}
                >
                  {t(
                    tableEdit.saving
                      ? "common.actions.saving"
                      : "common.actions.saveChanges",
                  )}
                </button>
              </>
            ) : (
              <button
                id={`${tableId}-edit`}
                type="button"
                title={t("table.edit.start")}
                aria-label={t(
                  tableEdit.loading ? "table.edit.loading" : "table.edit.start",
                )}
                disabled={
                  controlsDisabled ||
                  items.length === 0 ||
                  !fields.some((field) => field.field_type !== "id")
                }
                className="flex size-8 cursor-pointer items-center justify-center rounded-sm text-muted transition enabled:hover:bg-control-hover enabled:hover:text-accent focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => {
                  setColumnMenu(null);
                  beginTableEditing();
                }}
              >
                <svg
                  aria-hidden="true"
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z" />
                </svg>
              </button>
            )}
            <fieldset disabled={tableEdit.active} className="contents">
              {actions}
            </fieldset>
          </>
        }
        wrapText={wrapText}
        onWrapTextChange={setWrapText}
        disabled={controlsDisabled}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start overflow-hidden rounded-b-md border border-shell bg-surface">
        <div
          ref={dataViewport}
          className="min-w-0 overflow-x-auto"
          role="region"
          aria-label={t("items.title")}
          tabIndex={0}
        >
          <table
            ref={dataTable}
            className={`table-fixed border-collapse text-left text-sm ${resizing ? "select-none" : ""}`}
            style={{ width: tableWidth }}
          >
            <caption className="sr-only">{t("table.sortHint")}</caption>
            <colgroup>
              {visibleColumns.map(({ field, width }) => (
                <col key={field.id} style={{ width }} />
              ))}
            </colgroup>
            <thead className="bg-surface-muted text-xs font-semibold uppercase tracking-wider text-muted">
              <tr>
                {visibleColumns.map(({ field, baseWidth }) => (
                  <th
                    data-field-id={field.id}
                    aria-label={field.name}
                    aria-sort={
                      sortField?.id === field.id ? sort?.direction : undefined
                    }
                    className="relative border-b border-shell p-0"
                    key={field.id}
                    scope="col"
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openColumnMenu(
                        field.id,
                        event.currentTarget,
                        event.clientX,
                        event.clientY,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.key === "ContextMenu" ||
                        (event.shiftKey && event.key === "F10")
                      ) {
                        event.preventDefault();
                        event.stopPropagation();
                        openColumnMenu(
                          field.id,
                          event.currentTarget,
                          0,
                          0,
                          event.target instanceof HTMLElement
                            ? event.target
                            : undefined,
                        );
                      }
                    }}
                  >
                    {field.is_sortable ? (
                      <button
                        className={`relative block w-full cursor-pointer py-3 pr-7 pl-3 text-left font-semibold transition-colors enabled:hover:bg-control-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${sortField?.id === field.id ? "bg-accent-soft text-accent" : ""}`}
                        onClick={() => toggleSort(field.id)}
                        disabled={tableEdit.active}
                        type="button"
                      >
                        <span
                          data-column-heading=""
                          className="block truncate"
                          title={field.name}
                        >
                          {field.name}
                        </span>
                        {/* Reserve the indicator space so sorting never shifts the heading. */}
                        <span
                          aria-hidden="true"
                          className="absolute top-1/2 right-2.5 flex size-3 -translate-y-1/2 items-center justify-center"
                        >
                          {sortField?.id === field.id && sort && (
                            <svg
                              className="size-3"
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
                      <span
                        data-column-heading=""
                        className="block truncate px-3 py-3"
                        title={field.name}
                      >
                        {field.name}
                      </span>
                    )}
                    <ColumnResizeHandle
                      fieldName={field.name}
                      width={baseWidth}
                      disabled={
                        tableEdit.active ||
                        isMutating ||
                        editingItem !== null ||
                        deletingTarget !== null ||
                        (resizing !== null && resizing.fieldId !== field.id)
                      }
                      onPreview={(nextWidth) =>
                        setResizing(
                          nextWidth === null
                            ? null
                            : { fieldId: field.id, width: nextWidth },
                        )
                      }
                      onCommit={(nextWidth) =>
                        setColumnWidth(field.id, nextWidth)
                      }
                      onReset={() => setAutomaticColumnWidth(field.id)}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-shell">
              {displayedItems.map((item) => {
                const valuesByField = new Map(
                  item.values.map((value) => [value.field_id, value]),
                );

                return (
                  <tr
                    className="group"
                    key={item.id}
                    id={`${tableId}-${item.id}`}
                    data-item-id={item.id}
                    onPointerEnter={() => setHoveredItem(item.id)}
                    onPointerLeave={() => setHoveredItem(null)}
                  >
                    {visibleFields.map((field) => {
                      const content = formatValue(
                        field,
                        valuesByField.get(field.id),
                        {
                          no: t("common.values.no"),
                          yes: t("common.values.yes"),
                        },
                        i18n.resolvedLanguage ?? "en",
                      );
                      return (
                        <td
                          className={`h-13 border-r border-shell/60 px-3 py-2.5 align-top text-foreground transition-colors last:border-r-0 group-hover:bg-surface-hover ${hoveredItem === item.id ? "bg-surface-hover" : ""}`}
                          key={field.id}
                        >
                          {tableEdit.draft && field.field_type !== "id" ? (
                            <InventoryTableCellInput
                              key={`${item.id}-${field.id}`}
                              id={`${tableId}-${item.id}-${field.id}-input`}
                              field={field}
                              value={
                                Object.hasOwn(
                                  tableEdit.draft.changes[item.id] ?? {},
                                  field.id,
                                )
                                  ? tableEdit.draft.changes[item.id][field.id]
                                  : getTableCellValue(
                                      field,
                                      valuesByField.get(field.id)?.value,
                                    )
                              }
                              disabled={
                                tableEdit.saving ||
                                tableEdit.loading ||
                                tableEdit.conflict
                              }
                              error={
                                tableEdit.errors.find(
                                  (error) =>
                                    error.itemId === item.id &&
                                    error.fieldId === field.id,
                                )?.error
                              }
                              onChange={(value) =>
                                tableEdit.change(item.id, field.id, value)
                              }
                            />
                          ) : field.field_type === "checkbox" ? (
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
                                    : valuesByField.get(field.id)?.value ===
                                      true
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
                              title={
                                !wrapText && typeof content === "string"
                                  ? content
                                  : undefined
                              }
                              className={
                                wrapText
                                  ? "block whitespace-pre-wrap wrap-anywhere"
                                  : "block truncate"
                              }
                            >
                              {content}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {displayedItems.length === 0 && (
                <tr>
                  <td
                    className="px-6 py-12 text-center"
                    colSpan={visibleFields.length}
                  >
                    <p className="font-semibold text-heading">
                      {t(
                        items.length === 0
                          ? "items.empty"
                          : "table.search.empty",
                      )}
                    </p>
                    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                      {t(
                        items.length === 0
                          ? "items.emptyDescription"
                          : "table.search.emptyDescription",
                      )}
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="self-stretch border-l border-shell bg-surface">
          <table
            aria-label={t("table.actions")}
            className="border-collapse text-sm"
          >
            <thead className="bg-surface-muted text-xs font-semibold uppercase tracking-wider text-muted">
              <tr style={{ height: rowHeights.header }}>
                <th
                  className="border-b border-shell px-4 py-3 text-right"
                  scope="col"
                >
                  {t("table.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-shell">
              {displayedItems.map((item) => (
                <tr
                  key={item.id}
                  style={{ height: rowHeights.rows[item.id] }}
                  onPointerEnter={() => setHoveredItem(item.id)}
                  onPointerLeave={() => setHoveredItem(null)}
                >
                  <td
                    // Leave room for row borders below the 52 px source minimum (32 px buttons + 16 px padding).
                    className={`h-13 px-4 py-2 align-top transition-colors ${hoveredItem === item.id ? "bg-surface-hover" : ""}`}
                  >
                    <div className="flex justify-end gap-2 whitespace-nowrap">
                      <button
                        className="flex size-8 cursor-pointer items-center justify-center rounded-sm border border-shell transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={t("common.actions.edit")}
                        title={t("common.actions.edit")}
                        aria-describedby={`${tableId}-${item.id}`}
                        disabled={isMutating || tableEdit.active}
                        onClick={() => startEditing(item)}
                        type="button"
                      >
                        <svg
                          aria-hidden="true"
                          className="size-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z" />
                        </svg>
                      </button>
                      <button
                        className="flex size-8 cursor-pointer items-center justify-center rounded-sm bg-danger-soft text-danger transition enabled:hover:bg-danger/25 focus-visible:outline-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={t(
                          deleteItem.isPending
                            ? "common.actions.deleting"
                            : "common.actions.delete",
                        )}
                        title={t("common.actions.delete")}
                        aria-busy={deleteItem.isPending || undefined}
                        aria-describedby={`${tableId}-${item.id}`}
                        disabled={isMutating || tableEdit.active}
                        onClick={() => handleDelete(item)}
                        type="button"
                      >
                        <svg
                          aria-hidden="true"
                          className="size-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {columnMenu && menuField && (
        <ContextMenu
          x={columnMenu.x}
          y={columnMenu.y}
          label={t("table.columnMenu.label", { field: menuField.name })}
          onClose={closeColumnMenu}
          actions={[
            {
              label: t("table.columnMenu.automatic"),
              checked: view.columnWidths[menuField.id] === undefined,
              onSelect: () => {
                setAutomaticColumnWidth(menuField.id);
                closeColumnMenu();
              },
            },
            {
              label: t("table.columnMenu.hide"),
              disabled: visibleFields.length <= 1,
              onSelect: () => {
                toggleField(menuField.id);
                setColumnMenu(null);
                dataViewport.current?.focus();
              },
            },
          ]}
        />
      )}

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
