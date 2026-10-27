import type { InventoryField } from "../types/inventoryField";
import type { InventoryItem } from "../types/inventoryItem";
import type { ItemSort } from "../types/inventoryView";
import { comparableItemValue } from "./inventoryItemComparison";

/**
 * Sort a copy of the items while keeping empty values last in both directions.
 * @param items The inventory items in their original order.
 * @param field The column used for sorting.
 * @param direction The desired sort direction.
 * @param locale The application language used to compare text.
 * @returns A sorted array without mutating the original items.
 */
export function sortInventoryItems(
  items: InventoryItem[],
  field: InventoryField,
  direction: ItemSort["direction"],
  locale: string,
): InventoryItem[] {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  const keyedItems = items.map((item) => ({
    item,
    key: comparableItemValue(
      field,
      item.values.find((value) => value.field_id === field.id)?.value,
      collator,
      item.attachments,
    ),
  }));
  return keyedItems
    .sort((left, right) => {
      if (left.key === null) return right.key === null ? 0 : 1;
      if (right.key === null) return -1;
      const comparison =
        typeof left.key === "number" && typeof right.key === "number"
          ? left.key - right.key
          : collator.compare(String(left.key), String(right.key));
      return direction === "ascending" ? comparison : -comparison;
    })
    .map(({ item }) => item);
}
