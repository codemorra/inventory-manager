import { expect, test } from "vitest";
import { searchInventoryItems } from "../../src/components/inventoryItemSearch";
import type {
  InventoryField,
  InventoryFieldType,
} from "../../src/types/inventoryField";
import type { InventoryItem } from "../../src/types/inventoryItem";

/**
 * Build a searchable field with a technical option ID distinct from its label.
 * @param type The type whose user-facing values should be searched.
 * @returns A complete field definition.
 */
function field(type: InventoryFieldType): InventoryField {
  return {
    id: "field",
    inventory_id: "inventory",
    name: "Not searchable heading",
    field_type: type,
    max_length: null,
    is_required: false,
    is_sortable: true,
    position: 0,
    created_at: "",
    updated_at: "",
    options: [
      {
        id: "technical-option-id",
        field_id: "field",
        name: "Adapter",
        position: 0,
        created_at: "",
        updated_at: "",
      },
    ],
  };
}

/**
 * Build a stored item without altering the type of its supplied value.
 * @param value The field content being searched.
 * @returns An item with one value and technical metadata.
 */
function item(value: unknown): InventoryItem {
  return {
    id: "technical-item-id",
    inventory_id: "inventory",
    revision: 1,
    created_at: "",
    updated_at: "",
    values: [
      { id: "value", field_id: "field", value, created_at: "", updated_at: "" },
    ],
  };
}

// Test meaningful display values for every supported field type, including false and zero.
test.each<[InventoryFieldType, unknown, string]>([
  ["text", "USB Adapter", "  usb ADAPTER "],
  ["text", "Cafe\u0301", "CAFÉ"],
  ["number", 0, "0"],
  ["id", 123, "23"],
  ["boolean", false, "nein"],
  ["checkbox", true, "ja"],
  ["select", "technical-option-id", "adapter"],
  ["multiselect", ["technical-option-id"], "ADAPTER"],
  ["url", { url: "https://example.com/manual", label: "Guide" }, "example.com"],
  ["url", { url: "https://example.com/manual", label: "Guide" }, "guide"],
  ["date", "2026-10-26", "2026-10"],
  ["time", "13:45", "13:45"],
  ["datetime", "2026-10-26T13:45", "26T13"],
  ["duration", 3660, "1 h 1 min"],
])("searches %s user-facing values", (type, value, query) => {
  const entry = item(value);
  expect(
    searchInventoryItems(
      [entry],
      [field(type)],
      query,
      { yes: "Ja", no: "Nein" },
      "de",
    ),
  ).toEqual([entry]);
});

// Test absent or malformed values do not become phantom matches or technical metadata.
test.each<[InventoryFieldType, unknown, string]>([
  ["text", null, "—"],
  ["text", undefined, "undefined"],
  ["text", { unexpected: "adapter" }, "object"],
  ["url", { url: 42 }, "42"],
  ["select", "technical-option-id", "technical-option-id"],
  ["multiselect", [], "adapter"],
  ["text", "Value", "technical-item-id"],
  ["text", "Value", "Not searchable heading"],
  ["text", "USB Adapter", "^USB"],
])("ignores non-content in %s search", (type, value, query) => {
  expect(
    searchInventoryItems(
      [item(value)],
      [field(type)],
      query,
      { yes: "Yes", no: "No" },
      "en",
    ),
  ).toEqual([]);
});

// Test clearing preserves the original array, and active searches never reorder or mutate it.
test("preserves source order and ignores deleted field values", () => {
  const first = item("Adapter B");
  const second = { ...item("Adapter A"), id: "other" };
  const entries = [first, second];
  expect(
    searchInventoryItems(
      entries,
      [field("text")],
      " \n ",
      { yes: "Yes", no: "No" },
      "en",
    ),
  ).toBe(entries);
  expect(
    searchInventoryItems(
      entries,
      [field("text")],
      "adapter",
      { yes: "Yes", no: "No" },
      "en",
    ),
  ).toEqual(entries);
  expect(
    searchInventoryItems(
      entries,
      [],
      "adapter",
      { yes: "Yes", no: "No" },
      "en",
    ),
  ).toEqual([]);
  expect(entries).toEqual([first, second]);
});
