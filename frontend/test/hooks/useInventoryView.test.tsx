import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import {
  inventoryViewStorageKey,
  useInventoryView,
} from "../../src/hooks/useInventoryView";
import type { InventoryField } from "../../src/types/inventoryField";

const fields: InventoryField[] = ["first", "second"].map((id, position) => ({
  id,
  name: id,
  inventory_id: "inventory-1",
  field_type: "text",
  max_length: 255,
  position,
  is_required: false,
  is_sortable: true,
  options: [],
  created_at: "",
  updated_at: "",
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Test malformed storage cannot crash an inventory or hide every available column.
test.each([
  "invalid json",
  "null",
  "[]",
  '{"version":9}',
  '{"version":1,"sort":42,"hiddenFieldIds":false,"wrapText":"no"}',
])("falls back to the default view for invalid preferences: %s", (saved) => {
  localStorage.setItem(inventoryViewStorageKey("inventory-1"), saved);
  const { result } = renderHook(() => useInventoryView("inventory-1", fields));
  expect(result.current.view).toEqual({
    version: 1,
    sort: null,
    hiddenFieldIds: [],
    wrapText: true,
  });
});

// Test stale field references are ignored and new fields stay visible by default.
test("validates saved fields against additions, deletions, and sorting configuration", () => {
  localStorage.setItem(
    inventoryViewStorageKey("inventory-1"),
    JSON.stringify({
      version: 1,
      sort: { fieldId: "first", direction: "descending" },
      hiddenFieldIds: ["second", "deleted", "second", 3],
      wrapText: false,
    }),
  );
  const { result, rerender } = renderHook(
    ({ currentFields }) => useInventoryView("inventory-1", currentFields),
    {
      initialProps: { currentFields: fields },
    },
  );
  expect(result.current.view.hiddenFieldIds).toEqual(["second"]);
  expect(result.current.view.sort).toEqual({
    fieldId: "first",
    direction: "descending",
  });
  rerender({
    currentFields: [{ ...fields[0], is_sortable: false }, fields[1]],
  });
  expect(result.current.view.sort).toBeNull();
  rerender({ currentFields: [fields[1], { ...fields[0], id: "new" }] });
  expect(result.current.view.sort).toBeNull();
  expect(result.current.view.hiddenFieldIds).toEqual(["second"]);
});

// Test unusable saved visibility recovers one column and cannot hide it through actions.
test("retains a visible column even when saved preferences hide all fields", () => {
  localStorage.setItem(
    inventoryViewStorageKey("inventory-1"),
    JSON.stringify({
      version: 1,
      hiddenFieldIds: ["first", "second"],
      sort: { fieldId: "second", direction: "ascending" },
    }),
  );
  const { result } = renderHook(() => useInventoryView("inventory-1", fields));
  expect(result.current.view.hiddenFieldIds).toEqual(["second"]);
  expect(result.current.view.sort).toBeNull();
  act(() => result.current.toggleField("first"));
  expect(result.current.view.hiddenFieldIds).toEqual(["second"]);
});

// Test writes merge with the latest view and notify both this window and another tab.
test("synchronizes mounted tables and external storage changes", () => {
  const first = renderHook(() => useInventoryView("inventory-1", fields));
  const second = renderHook(() => useInventoryView("inventory-1", fields));
  act(() => first.result.current.toggleSort("first"));
  expect(second.result.current.view.sort).toEqual({
    fieldId: "first",
    direction: "ascending",
  });
  act(() => second.result.current.setWrapText(false));
  expect(first.result.current.view.wrapText).toBe(false);
  expect(first.result.current.view.sort?.fieldId).toBe("first");
  act(() => {
    const key = inventoryViewStorageKey("inventory-1");
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, hiddenFieldIds: ["first"], wrapText: true }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  expect(first.result.current.view.hiddenFieldIds).toEqual(["first"]);
  expect(second.result.current.view.wrapText).toBe(true);
});

// Test view actions remain usable without persistent storage permission or quota.
test("keeps a session view when browser storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const { result } = renderHook(() => useInventoryView("inventory-1", fields));
  act(() => result.current.toggleField("second"));
  act(() => result.current.setWrapText(false));
  expect(result.current.view.hiddenFieldIds).toEqual(["second"]);
  expect(result.current.view.wrapText).toBe(false);
});
