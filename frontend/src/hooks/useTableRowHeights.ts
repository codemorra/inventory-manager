import { useLayoutEffect, useState, type RefObject } from "react";
import type { InventoryItem } from "../types/inventoryItem";

// Match the independent actions pane to the data table's natural row sizes.
interface TableRowHeights {
  header: number | undefined;
  rows: Record<string, number>;
}

/**
 * Keep the action rows aligned when values wrap, columns resize, or data changes.
 * @param table The data table, whose height is never forced by this hook.
 * @param items The active items, used to refresh observation when rows are replaced.
 * @returns Header and item heights for the independent action table.
 */
export function useTableRowHeights(
  table: RefObject<HTMLTableElement | null>,
  items: InventoryItem[],
) {
  const [heights, setHeights] = useState<TableRowHeights>({
    header: undefined,
    rows: {},
  });
  useLayoutEffect(() => {
    const element = table.current;
    if (!element) return;
    /** Measure source rows only, avoiding a feedback loop from the action pane. */
    function measureRows() {
      if (!element) return;
      const header = element.tHead?.getBoundingClientRect().height || undefined;
      const rows: Record<string, number> = {};
      for (const row of Array.from(
        element.querySelectorAll<HTMLTableRowElement>("tr[data-item-id]"),
      )) {
        const id = row.dataset.itemId;
        const height = row.getBoundingClientRect().height;
        if (id && height > 0) rows[id] = height;
      }
      setHeights((current) =>
        current.header === header &&
        Object.keys(current.rows).length === Object.keys(rows).length &&
        Object.entries(rows).every(
          ([id, height]) => current.rows[id] === height,
        )
          ? current
          : { header, rows },
      );
    }
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measureRows);
    for (const row of Array.from(element.querySelectorAll("tr")))
      observer?.observe(row);
    measureRows();
    return () => {
      observer?.disconnect();
    };
  }, [table, items]);
  return heights;
}
