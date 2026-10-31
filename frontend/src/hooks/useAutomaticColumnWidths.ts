import { useLayoutEffect, useMemo, useState, type RefObject } from "react";
import {
  defaultColumnWidth,
  type ColumnTextMeasure,
} from "../appearance/inventoryColumns";
import type { InventoryField } from "../types/inventoryField";

// Size the content actually displayed, including option names and URL labels.
export interface ColumnContents {
  field: InventoryField;
  values: string[];
}

/**
 * Fit default widths using the actual table fonts once its DOM is available.
 * @param columns The current fields and their formatted values.
 * @param table The rendered data table used to read header and body typography.
 * @param visibleFields A stable signature refreshing measurements when hidden headings reappear.
 * @returns Automatic base widths before surplus space or saved preferences are applied.
 */
export function useAutomaticColumnWidths(
  columns: ColumnContents[],
  table: RefObject<HTMLTableElement | null>,
  visibleFields: string,
) {
  const fallback = useMemo(
    () =>
      Object.fromEntries(
        columns.map(({ field, values }) => [
          field.id,
          defaultColumnWidth(field, values),
        ]),
      ),
    [columns],
  );
  const [measured, setMeasured] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    /** Measure after layout and again if a web font finishes loading. */
    function measureWidths() {
      const element = table.current;
      if (!element) return;
      const labels = Array.from(
        element.querySelectorAll<HTMLElement>("[data-column-heading]"),
      );
      if (labels.length === 0) return;
      const byField = new Map(
        labels.map((label) => [label.closest("th")?.dataset.fieldId, label]),
      );
      const context =
        typeof CanvasRenderingContext2D === "undefined"
          ? null
          : document.createElement("canvas").getContext("2d");
      const bodyStyle = getComputedStyle(element);
      if (context)
        context.font = `${bodyStyle.fontWeight} ${bodyStyle.fontSize} ${bodyStyle.fontFamily}`;
      // Measure the actual heading label's font, including buttons' typography and letter spacing.
      const probe = document.createElement("span");
      Object.assign(probe.style, {
        position: "fixed",
        left: "-100000px",
        top: "0",
        visibility: "hidden",
        display: "inline-block",
        width: "max-content",
        maxWidth: "none",
        whiteSpace: "pre",
        padding: "0",
        border: "0",
      });
      probe.setAttribute("aria-hidden", "true");
      document.body.append(probe);
      let hasMeasurements = !!context;
      try {
        const next = Object.fromEntries(
          columns.map(({ field, values }) => {
            const style = getComputedStyle(byField.get(field.id) ?? labels[0]);
            const measure: ColumnTextMeasure = (text, header) => {
              if (header) {
                probe.style.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                probe.style.letterSpacing = style.letterSpacing;
                probe.textContent = text;
                const width = probe.getBoundingClientRect().width;
                if (width > 0) {
                  hasMeasurements = true;
                  return width;
                }
                return Array.from(text).length * 8;
              }
              const spacing = Number.parseFloat(bodyStyle.letterSpacing) || 0;
              return context
                ? context.measureText(text).width +
                    Math.max(0, Array.from(text).length - 1) * spacing
                : Array.from(text).length * 7;
            };
            return [field.id, defaultColumnWidth(field, values, measure)];
          }),
        );
        if (hasMeasurements)
          setMeasured((current) =>
            Object.keys(current).length === Object.keys(next).length &&
            Object.entries(next).every(([id, width]) => current[id] === width)
              ? current
              : next,
          );
      } finally {
        probe.remove();
      }
    }
    measureWidths();
    document.fonts?.addEventListener("loadingdone", measureWidths);
    return () => {
      document.fonts?.removeEventListener("loadingdone", measureWidths);
    };
  }, [columns, table, visibleFields]);

  return Object.fromEntries(
    columns.map(({ field }) => [
      field.id,
      measured[field.id] ?? fallback[field.id],
    ]),
  );
}
