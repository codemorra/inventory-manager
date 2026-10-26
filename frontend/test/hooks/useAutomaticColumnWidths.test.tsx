import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useAutomaticColumnWidths } from "../../src/hooks/useAutomaticColumnWidths";
import type { InventoryField } from "../../src/types/inventoryField";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// Test the real label measurement overrides a smaller ancestor-font estimate for a short numeric title.
test("fits a short heading using its actual label rather than the table font", () => {
  let frame: FrameRequestCallback | undefined;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal("CanvasRenderingContext2D", undefined);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return {
        width: this.getAttribute("aria-hidden") === "true" ? 29 : 0,
      } as DOMRect;
    },
  );
  const table = document.createElement("table");
  table.innerHTML =
    '<thead><tr><th data-field-id="numbers"><button><span data-column-heading>123</span></button></th></tr></thead>';
  const field: InventoryField = {
    id: "numbers",
    inventory_id: "inventory-1",
    name: "123",
    field_type: "number",
    is_sortable: true,
    is_required: false,
    max_length: null,
    position: 0,
    options: [],
    created_at: "",
    updated_at: "",
  };
  const columns = [{ field, values: ["1"] }];
  const ref = { current: table };
  const { result } = renderHook(() =>
    useAutomaticColumnWidths(columns, ref, "numbers"),
  );
  act(() => frame?.(0));
  expect(result.current.numbers).toBeGreaterThanOrEqual(29 + 40 + 4);
  expect(
    document.querySelector('span[aria-hidden="true"]'),
  ).not.toBeInTheDocument();
});
