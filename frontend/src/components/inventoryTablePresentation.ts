import type { InventoryField } from "../types/inventoryField";
import type { InventoryItem } from "../types/inventoryItem";
import type { InventoryViewPreferences } from "../types/inventoryView";
import type { ItemFilter } from "../types/itemFilter";
import {
  searchInventoryItems,
  type ItemSearchLabels,
} from "./inventoryItemSearch";
import { filterInventoryItems, itemFilterError } from "./inventoryItemFilters";
import { sortInventoryItems } from "./inventoryItemSorting";

// An edit session freezes presentation at entry without persisting search, filters or surplus widths.
export interface InventoryTablePresentation {
  view: InventoryViewPreferences;
  searchQuery: string;
  filters: ItemFilter[];
  locale: string;
  booleanLabels: ItemSearchLabels;
}

/**
 * Capture a view against the freshly loaded fields, tolerating configuration changes during loading.
 * @param presentation The view, search/filter rules, and locale selected when editing began.
 * @param fields The field definitions loaded with the edit-session configuration revision.
 * @returns A private presentation snapshot, independent of subsequent browser-storage changes.
 */
export function captureTablePresentation(
  presentation: InventoryTablePresentation,
  fields: InventoryField[],
): InventoryTablePresentation {
  const captured = structuredClone(presentation);
  const ids = new Set(fields.map((field) => field.id));
  captured.view.hiddenFieldIds = captured.view.hiddenFieldIds.filter((id) =>
    ids.has(id),
  );
  if (
    fields.length > 0 &&
    captured.view.hiddenFieldIds.length === fields.length
  )
    captured.view.hiddenFieldIds = captured.view.hiddenFieldIds.filter(
      (id) => id !== fields[0].id,
    );
  const sorted = fields.find(
    (field) => field.id === captured.view.sort?.fieldId,
  );
  if (!sorted?.is_sortable || captured.view.hiddenFieldIds.includes(sorted.id))
    captured.view.sort = null;
  captured.filters = captured.filters.filter(
    (filter) => !itemFilterError(filter, fields),
  );
  return captured;
}

/**
 * Select and order a session's rows once, before cell drafts can affect their membership or order.
 * @param items The freshly loaded original item snapshots.
 * @param fields The session's field definitions.
 * @param presentation The captured view and language-dependent matching rules.
 * @returns Stable displayed rows in the selected sort order, without mutating the originals.
 */
export function presentInventoryItems(
  items: InventoryItem[],
  fields: InventoryField[],
  presentation: InventoryTablePresentation,
): InventoryItem[] {
  const searched = searchInventoryItems(
    items,
    fields,
    presentation.searchQuery,
    presentation.booleanLabels,
    presentation.locale,
  );
  const filtered = filterInventoryItems(
    searched,
    fields,
    presentation.filters,
    presentation.locale,
  );
  const sort = presentation.view.sort;
  const field = fields.find(
    (field) => field.id === sort?.fieldId && field.is_sortable,
  );
  return sort && field
    ? sortInventoryItems(filtered, field, sort.direction, presentation.locale)
    : filtered;
}
