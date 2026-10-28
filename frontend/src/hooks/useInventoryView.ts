import { preferenceStore } from "../preferences/store";
import { useSyncExternalStore } from "react";
import {
  clampColumnWidth,
  MIN_COLUMN_WIDTH,
  MAX_STORED_COLUMN_WIDTH,
} from "../appearance/inventoryColumns";
import type { InventoryField } from "../types/inventoryField";
import type {
  InventoryViewPreferences,
  ItemSort,
} from "../types/inventoryView";

/**
 * Validate saved presentation settings against the current field configuration.
 * @param raw The saved JSON, or null for a first visit.
 * @param fields The active fields in their configured order.
 * @returns Safe preferences with at least one visible field when fields exist.
 */
function readView(
  raw: string | null,
  fields: InventoryField[],
): InventoryViewPreferences {
  let saved: Partial<InventoryViewPreferences> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? "null");
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      parsed.version === 1
    )
      saved = parsed as Partial<InventoryViewPreferences>;
  } catch {
    // Invalid presentation data must not prevent opening an inventory.
  }
  const activeIds = new Set(fields.map((field) => field.id));
  let hiddenFieldIds = Array.isArray(saved.hiddenFieldIds)
    ? [
        ...new Set(
          saved.hiddenFieldIds.filter(
            (id) => typeof id === "string" && activeIds.has(id),
          ),
        ),
      ]
    : [];
  if (fields.length > 0 && hiddenFieldIds.length === fields.length)
    hiddenFieldIds = hiddenFieldIds.filter((id) => id !== fields[0].id);
  const sort = saved.sort;
  const sortField = fields.find((field) => field.id === sort?.fieldId);
  return {
    version: 1,
    sort:
      sort &&
      (sort.direction === "ascending" || sort.direction === "descending") &&
      sortField?.is_sortable &&
      !hiddenFieldIds.includes(sortField.id)
        ? { fieldId: sortField.id, direction: sort.direction }
        : null,
    hiddenFieldIds,
    wrapText: typeof saved.wrapText === "boolean" ? saved.wrapText : true,
    attachmentPreviews: saved.attachmentPreviews === true,
    columnWidths:
      saved.columnWidths &&
      typeof saved.columnWidths === "object" &&
      !Array.isArray(saved.columnWidths)
        ? Object.fromEntries(
            Object.entries(saved.columnWidths).filter(
              ([id, width]) =>
                activeIds.has(id) &&
                typeof width === "number" &&
                Number.isInteger(width) &&
                width >= MIN_COLUMN_WIDTH &&
                width <= MAX_STORED_COLUMN_WIDTH,
            ),
          )
        : {},
  };
}

/**
 * Persist table presentation per inventory without changing its configuration.
 * @param inventoryId The inventory whose preferences are read and written.
 * @param fields The current fields used to discard stale references.
 * @returns The safe view and actions for sorting, wrapping, column visibility, and widths.
 */
export function useInventoryView(
  inventoryId: string,
  fields: InventoryField[],
) {
  const raw = useSyncExternalStore(
    preferenceStore.subscribe,
    () => preferenceStore.readView(inventoryId),
    () => null,
  );
  const view = readView(raw, fields);

  /**
   * Merge a user action with the latest saved view and notify other mounted tables.
   * @param update The change to apply to validated preferences.
   */
  function updateView(
    update: (current: InventoryViewPreferences) => InventoryViewPreferences,
  ) {
    const next = update(
      readView(preferenceStore.readView(inventoryId), fields),
    );
    const normalized = readView(JSON.stringify(next), fields);
    preferenceStore.setView(inventoryId, normalized);
  }

  /**
   * Cycle a visible, sortable column through both directions and original order.
   * @param fieldId The column chosen in the table header.
   */
  function toggleSort(fieldId: string) {
    updateView((current) => {
      const previous = current.sort;
      const sort: ItemSort | null =
        previous?.fieldId !== fieldId
          ? { fieldId, direction: "ascending" }
          : previous.direction === "ascending"
            ? { fieldId, direction: "descending" }
            : null;
      return { ...current, sort };
    });
  }

  /**
   * Change a column's visibility while retaining one visible column.
   * @param fieldId The field selected in the View menu.
   */
  function toggleField(fieldId: string) {
    updateView((current) => {
      if (!fields.some((field) => field.id === fieldId)) return current;
      const hidden = current.hiddenFieldIds.includes(fieldId);
      if (!hidden && fields.length - current.hiddenFieldIds.length <= 1)
        return current;
      return {
        ...current,
        hiddenFieldIds: hidden
          ? current.hiddenFieldIds.filter((id) => id !== fieldId)
          : [...current.hiddenFieldIds, fieldId],
      };
    });
  }

  /**
   * Store whether table values wrap across multiple lines.
   * @param wrapText The requested text presentation.
   */
  function setWrapText(wrapText: boolean) {
    updateView((current) => ({ ...current, wrapText }));
  }

  /**
   * Store optional image previews separately for each inventory, defaulting to filenames only.
   * @param attachmentPreviews Whether supported files show thumbnail tiles.
   */
  function setAttachmentPreviews(attachmentPreviews: boolean) {
    updateView((current) => ({ ...current, attachmentPreviews }));
  }

  /**
   * Save only the manually edited column's base, never a runtime layout or other widths.
   * @param fieldId The field whose Auto mode is disabled by this manual edit.
   * @param width The requested base width, excluding temporary display surplus.
   */
  function setColumnWidth(fieldId: string, width: number) {
    if (!fields.some((field) => field.id === fieldId)) return;
    updateView((current) => ({
      ...current,
      columnWidths: {
        ...current.columnWidths,
        [fieldId]: clampColumnWidth(width),
      },
    }));
  }

  /**
   * Enable Auto by removing one manual override, or all overrides for this inventory.
   * @param fieldId The field to make automatic, or undefined to make all fields automatic.
   */
  function setAutomaticColumnWidth(fieldId?: string) {
    updateView((current) => ({
      ...current,
      columnWidths:
        fieldId === undefined
          ? {}
          : Object.fromEntries(
              Object.entries(current.columnWidths).filter(
                ([id]) => id !== fieldId,
              ),
            ),
    }));
  }

  return {
    view,
    toggleSort,
    toggleField,
    setWrapText,
    setAttachmentPreviews,
    setColumnWidth,
    setAutomaticColumnWidth,
  };
}
