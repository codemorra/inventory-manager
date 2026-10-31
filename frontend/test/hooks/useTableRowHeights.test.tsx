import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useTableRowHeights } from "../../src/hooks/useTableRowHeights";
import type { InventoryItem } from "../../src/types/inventoryItem";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Test the separate actions pane follows natural data-row growth and shrinking without forcing source heights.
test("tracks source header and item heights when wrapping or resizing changes them", () => {
  let onResize: () => void = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        onResize = vi.fn(callback);
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  const table = document.createElement("table");
  table.innerHTML =
    '<thead><tr><th>Title</th></tr></thead><tbody><tr data-item-id="first"><td>Text</td></tr><tr data-item-id="second"><td>Text</td></tr></tbody>';
  const rowSizes: Record<string, number> = { first: 100, second: 52 };
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        height:
          this.tagName === "THEAD"
            ? 41
            : (rowSizes[this.dataset.itemId ?? ""] ?? 0),
      } as DOMRect;
    },
  );
  const ref = { current: table };
  const items: InventoryItem[] = [];
  const { result } = renderHook(() => useTableRowHeights(ref, items));
  expect(result.current).toEqual({
    header: 41,
    rows: { first: 100, second: 52 },
  });
  rowSizes.first = 52;
  rowSizes.second = 140;
  act(() => onResize());
  expect(result.current.rows).toEqual({ first: 52, second: 140 });
  expect(
    table.querySelector("tr[data-item-id=first]")?.getAttribute("style"),
  ).toBeNull();
});
