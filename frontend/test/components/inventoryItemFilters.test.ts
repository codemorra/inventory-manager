import { expect, test } from "vitest";
import {
  filterInventoryItems,
  itemFilterError,
} from "../../src/components/inventoryItemFilters";
import type { InventoryFieldType } from "../../src/types/inventoryField";
import type {
  ItemFilter,
  ItemFilterOperator,
} from "../../src/types/itemFilter";
import { filterField, filterItem, filterRule } from "../helpers/itemFilters";

// Test numeric/temporal comparisons and text/selection semantics with actual stored types.
test.each<[InventoryFieldType, unknown, ItemFilterOperator, string, boolean]>([
  ["text", "USB Adapter", "contains", "adapter", true],
  ["text", "USB Adapter", "notContains", "adapter", false],
  ["text", "Cable", "notContains", "adapter", true],
  ["text", "Café", "equals", "CAFE\u0301", true],
  ["text", "Adapter", "notEquals", "adapter", false],
  ["text", "Adapter", "contains", "^Ada", false],
  [
    "url",
    { url: "https://docs.example.com", label: "Guide" },
    "contains",
    "example.com",
    true,
  ],
  [
    "url",
    { url: "https://docs.example.com", label: "Guide" },
    "equals",
    "guide",
    true,
  ],
  [
    "url",
    { url: "https://docs.example.com", label: "Guide" },
    "notContains",
    "guide",
    false,
  ],
  ["number", 10, "greaterThan", "2", true],
  ["number", 2, "greaterThan", "10", false],
  ["number", 0, "equals", "0", true],
  ["number", -2.5, "atMost", "-2.5", true],
  ["number", 2.5, "atLeast", "2.5", true],
  ["number", 3, "lessThan", "3", false],
  ["number", 3, "notEquals", "4", true],
  ["id", 123, "atLeast", "100", true],
  ["date", "20261026", "equals", "2026-10-26", true],
  ["date", "2026-W44-1", "equals", "2026-10-26", true],
  ["date", "2026-10-25", "before", "2026-10-26", true],
  ["date", "2026-10-27", "after", "2026-10-26", true],
  ["time", "T134500+0200", "equals", "11:45", true],
  ["time", "13:45:30.5", "after", "13:45:30", true],
  ["datetime", "2026-W44-1T13:45+02:00", "equals", "2026-10-26T11:45", true],
  ["datetime", "20261026T134500", "before", "2026-10-27T00:00", true],
  ["duration", 3600, "equals", "1::", true],
  ["duration", 0, "equals", "::0", true],
  ["boolean", false, "isFalse", "", true],
  ["checkbox", false, "isFalse", "", true],
  ["checkbox", false, "isTrue", "", false],
])("applies %s %s with %s", (type, value, operator, input, expected) => {
  const field = filterField(type);
  const entry = filterItem({ [field.id]: value });
  const rule = filterRule(field, { operator, value: input });
  expect(itemFilterError(rule, [field])).toBeNull();
  expect(filterInventoryItems([entry], [field], [rule], "en")).toEqual(
    expected ? [entry] : [],
  );
});

// Test inclusive ranges, repeated conditions on one column, and source-order preservation.
test("combines conditions on the same field with AND and preserves source items", () => {
  const field = filterField("number");
  const entries = [20, 4, 5, 21].map((value) =>
    filterItem({ [field.id]: value }, String(value)),
  );
  const filters = [
    filterRule(field, { operator: "atLeast", value: "5" }),
    filterRule(field, { id: "second", operator: "atMost", value: "20" }),
  ];
  expect(
    filterInventoryItems(entries, [field], filters, "en").map(
      (item) => item.id,
    ),
  ).toEqual(["20", "5"]);
  expect(
    filterInventoryItems(
      entries,
      [field],
      [filterRule(field, { operator: "between", value: "5", valueTo: "20" })],
      "en",
    ).map((item) => item.id),
  ).toEqual(["20", "5"]);
  expect(entries.map((item) => item.id)).toEqual(["20", "4", "5", "21"]);
});

// Test option IDs, OR within a selection, negative selection, and AND across columns.
test("uses OR for selected options while combining different columns with AND", () => {
  const choice = filterField("multiselect");
  const flag = filterField("boolean");
  const entries = [
    filterItem({ [choice.id]: ["option-0"], [flag.id]: true }, "a"),
    filterItem({ [choice.id]: ["option-1"], [flag.id]: false }, "b"),
    filterItem({ [choice.id]: [], [flag.id]: true }, "empty"),
  ];
  const rule = filterRule(choice, {
    operator: "anyOf",
    optionIds: ["option-0", "option-1"],
  });
  expect(
    filterInventoryItems(entries, [choice, flag], [rule], "en").map(
      (item) => item.id,
    ),
  ).toEqual(["a", "b"]);
  expect(
    filterInventoryItems(
      entries,
      [choice, flag],
      [rule, filterRule(flag, { id: "flag", operator: "isTrue" })],
      "en",
    ).map((item) => item.id),
  ).toEqual(["a"]);
  expect(
    filterInventoryItems(
      entries,
      [choice],
      [filterRule(choice, { operator: "noneOf", optionIds: ["option-0"] })],
      "en",
    ).map((item) => item.id),
  ).toEqual(["b"]);
  const single = filterField("select");
  expect(
    filterInventoryItems(
      [filterItem({ [single.id]: "option-1" })],
      [single],
      [filterRule(single, { optionIds: ["option-0", "option-1"] })],
      "en",
    ),
  ).toHaveLength(1);
});

// Test empty cells are explicit and never confused with a zero or an unchecked checkbox.
test.each<[InventoryFieldType, unknown, boolean]>([
  ["text", null, true],
  ["text", undefined, true],
  ["text", "", true],
  ["multiselect", [], true],
  ["url", { url: "", label: "" }, true],
  ["number", 0, false],
  ["boolean", false, false],
  ["checkbox", false, false],
])("distinguishes emptiness for %s values", (type, value, empty) => {
  const field = filterField(type);
  const entry = filterItem({ [field.id]: value });
  expect(
    filterInventoryItems(
      [entry],
      [field],
      [filterRule(field, { operator: "isEmpty" })],
      "en",
    ),
  ).toHaveLength(empty ? 1 : 0);
  expect(
    filterInventoryItems(
      [entry],
      [field],
      [filterRule(field, { operator: "isNotEmpty" })],
      "en",
    ),
  ).toHaveLength(empty ? 0 : 1);
});

// Test invalid inputs and stale references are rejected before any conditions are applied.
test.each<[InventoryFieldType, Partial<ItemFilter>, string]>([
  ["text", { value: " " }, "value"],
  ["text", { operator: "before", value: "2026-10-26" }, "field"],
  ["number", { value: "Infinity" }, "value"],
  ["number", { value: "NaN" }, "value"],
  ["number", { operator: "between", value: "5", valueTo: "4" }, "range"],
  ["number", { operator: "between", value: "5", valueTo: "" }, "value"],
  ["id", { value: "1.5" }, "value"],
  ["id", { value: "0" }, "value"],
  ["date", { value: "2026-02-30" }, "value"],
  ["time", { value: "24:00" }, "value"],
  ["time", { value: "12:60" }, "value"],
  ["datetime", { value: "2026-10-26" }, "value"],
  ["duration", { value: "1:60:0" }, "value"],
  ["duration", { value: "::" }, "value"],
  ["select", { optionIds: [] }, "options"],
  ["select", { optionIds: ["deleted"] }, "options"],
  ["text", { fieldId: "deleted", value: "value" }, "field"],
  ["text", { fieldType: "number", value: "value" }, "field"],
])("rejects invalid %s conditions", (type, changes, error) => {
  const field = filterField(type);
  const rule = filterRule(field, changes);
  expect(itemFilterError(rule, [field])).toBe(error);
  const entries = [filterItem({ [field.id]: "unchanged" })];
  expect(filterInventoryItems(entries, [field], [rule], "en")).toBe(entries);
});

// Test negative comparisons require a real value rather than including missing cells implicitly.
test("excludes missing values from negative comparisons", () => {
  const field = filterField("text");
  const entries = [
    filterItem({}),
    filterItem({ [field.id]: "Cable" }, "cable"),
  ];
  expect(
    filterInventoryItems(
      entries,
      [field],
      [filterRule(field, { operator: "notContains", value: "adapter" })],
      "en",
    ).map((item) => item.id),
  ).toEqual(["cable"]);
});
