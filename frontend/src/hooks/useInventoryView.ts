import { useState, useSyncExternalStore } from "react";
import type { InventoryField } from "../types/inventoryField";
import type {
  InventoryViewPreferences,
  ItemSort,
} from "../types/inventoryView";

const changeEvent = "inventory-view-change";

/**
 * Return the browser preference key for one inventory, including empty inventories.
 * @param inventoryId The inventory whose view is stored.
 * @returns A stable key independent of field names and item contents.
 */
export function inventoryViewStorageKey(inventoryId: string): string {
  return `inventory-manager-view:${inventoryId}`;
}

/**
 * Listen for view changes in this window and other browser tabs.
 * @param onChange The callback refreshing the primitive storage snapshot.
 * @returns A function removing the event subscriptions.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(changeEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

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
    // Invalid browser preferences must not prevent opening an inventory.
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
  };
}

/**
 * Persist table presentation per inventory without changing its configuration.
 * @param inventoryId The inventory whose preferences are read and written.
 * @param fields The current fields used to discard stale references.
 * @returns The safe view and actions for sorting, wrapping, and column visibility.
 */
export function useInventoryView(
  inventoryId: string,
  fields: InventoryField[],
) {
  const key = inventoryViewStorageKey(inventoryId);
  // Retain a usable local view if browser storage is blocked or its quota is exhausted.
  const [temporary, setTemporary] = useState<{
    key: string;
    value: string;
  } | null>(null);

  /**
   * Read a stable primitive snapshot suitable for React's external-store subscription.
   * @returns Stored JSON or the current session's fallback when storage is unavailable.
   */
  function getSnapshot(): string | null {
    if (temporary?.key === key) return temporary.value;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const view = readView(raw, fields);

  /**
   * Merge a user action with the latest saved view and notify other mounted tables.
   * @param update The change to apply to validated preferences.
   */
  function updateView(
    update: (current: InventoryViewPreferences) => InventoryViewPreferences,
  ) {
    const next = update(readView(getSnapshot(), fields));
    const value = JSON.stringify(readView(JSON.stringify(next), fields));
    try {
      localStorage.setItem(key, value);
      setTemporary(null);
    } catch {
      setTemporary({ key, value });
    }
    window.dispatchEvent(new Event(changeEvent));
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

  return { view, toggleSort, toggleField, setWrapText };
}
