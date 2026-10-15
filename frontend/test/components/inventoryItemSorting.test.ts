import { describe, expect, test } from "vitest";

import { sortInventoryItems } from "../../src/components/inventoryItemSorting";
import type {
  InventoryField,
  InventoryFieldType,
} from "../../src/types/inventoryField";
import type { InventoryItem } from "../../src/types/inventoryItem";

/**
 * Build a stored item containing one sortable value.
 * @param value The stored field value.
 * @param index The unique identifier of the item.
 * @returns An inventory item for sorting tests.
 */
function item(value: unknown, index: number): InventoryItem {
  return {
    id: String(index),
    inventory_id: "inventory",
    created_at: "",
    updated_at: "",
    values: [
      {
        id: String(index),
        field_id: "field",
        value,
        created_at: "",
        updated_at: "",
      },
    ],
  };
}

/**
 * Build a column with labels whose alphabetical order differs from their IDs.
 * @param type The field type to compare.
 * @returns The sortable field definition.
 */
function field(type: InventoryFieldType): InventoryField {
  return {
    id: "field",
    inventory_id: "inventory",
    name: "Field",
    field_type: type,
    max_length: null,
    is_required: false,
    is_sortable: true,
    position: 0,
    created_at: "",
    updated_at: "",
    options: [
      {
        id: "a",
        field_id: "field",
        name: "Zebra",
        position: 0,
        created_at: "",
        updated_at: "",
      },
      {
        id: "z",
        field_id: "field",
        name: "Apple",
        position: 1,
        created_at: "",
        updated_at: "",
      },
    ],
  };
}

describe("sortInventoryItems", () => {
  // Test semantic comparisons for every supported field type in both directions.
  test.each<[InventoryFieldType, unknown, unknown]>([
    ["text", "Item 2", "Item 10"],
    ["number", 2, 10],
    ["duration", 60, 120],
    ["boolean", false, true],
    ["date", "2025-12-31", "2026-01-01"],
    ["time", "09:30", "10:00"],
    ["datetime", "2026-01-01T23:00", "2026-01-02T01:00"],
    ["select", "z", "a"],
    ["multiselect", ["z"], ["a"]],
  ])("sorts %s values without mutating the input", (type, first, second) => {
    const items = [item(second, 2), item(null, 3), item(first, 1)];
    expect(
      sortInventoryItems(items, field(type), "ascending", "en").map(
        (entry) => entry.id,
      ),
    ).toEqual(["1", "2", "3"]);
    expect(
      sortInventoryItems(items, field(type), "descending", "en").map(
        (entry) => entry.id,
      ),
    ).toEqual(["2", "1", "3"]);
    expect(items.map((entry) => entry.id)).toEqual(["2", "3", "1"]);
  });

  // Test comparisons of equivalent temporal values accepted by the backend.
  test.each<[InventoryFieldType, string, string]>([
    ["date", "2026-W01-1", "20251229"],
    ["time", "10:00+01:00", "090000"],
    ["datetime", "2026-01-01T10:00+01:00", "2026-01-01T09:00Z"],
  ])("keeps equal %s values in their original order", (type, left, right) => {
    const items = [item(left, 1), item(right, 2)];
    expect(
      sortInventoryItems(items, field(type), "ascending", "de").map(
        (entry) => entry.id,
      ),
    ).toEqual(["1", "2"]);
    expect(
      sortInventoryItems(items, field(type), "descending", "de").map(
        (entry) => entry.id,
      ),
    ).toEqual(["1", "2"]);
  });

  // Test that absent and empty multiselect values remain last in either direction.
  test("keeps all empty values last", () => {
    const items = [
      item([], 1),
      { ...item(null, 2), values: [] },
      item(["z"], 3),
    ];
    for (const direction of ["ascending", "descending"] as const) {
      expect(
        sortInventoryItems(items, field("multiselect"), direction, "en").map(
          (entry) => entry.id,
        ),
      ).toEqual(["3", "1", "2"]);
    }
  });
});
