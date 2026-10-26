import { expect, test } from "vitest";
import {
  createTableReplacement,
  tableCellError,
  unchangedTableCell,
} from "../../src/components/inventoryTableDraft";
import type { InventoryFieldType } from "../../src/types/inventoryField";
import type { InventoryItemFormValue } from "../../src/components/inventoryItemForm";
import { filterField, filterItem } from "../helpers/itemFilters";

// Test hidden, legacy and absent values survive a complete replacement without default coercion.
test("saves only changed rows, preserving untouched representations and original revisions", () => {
  const text = filterField("text");
  const date = filterField("datetime");
  const flag = filterField("boolean");
  const id = filterField("id");
  const url = filterField("url");
  const first = {
    ...filterItem({
      [text.id]: "Old",
      [date.id]: "2026-W44-1T13:45+02:00",
      [id.id]: 42,
      [url.id]: { url: "https://example.com", label: "Hidden" },
    }),
    revision: 8,
  };
  const second = filterItem({ [text.id]: "Untouched" }, "second");
  const result = createTableReplacement(
    [text, date, flag, id, url],
    [first, second],
    { [first.id]: { [text.id]: "New" } },
    7,
  );
  expect(result.errors).toEqual([]);
  expect(result.input).toEqual({
    expected_configuration_revision: 7,
    items: [
      {
        item_id: first.id,
        expected_revision: 8,
        values: [
          { field_id: text.id, value: "New" },
          { field_id: date.id, value: "2026-W44-1T13:45+02:00" },
          {
            field_id: url.id,
            value: { url: "https://example.com", label: "Hidden" },
          },
        ],
      },
    ],
  });
  expect(first.values[0].value).toBe("Old");
});

// Test incomplete drafts remain invalid rather than silently clearing URL/duration/number values.
test.each<[InventoryFieldType, InventoryItemFormValue, string | null]>([
  ["text", "Short", null],
  ["text", "x".repeat(256), "text"],
  ["number", "0", null],
  ["number", "-2.5", null],
  ["number", "1e2", null],
  ["number", "Infinity", "number"],
  ["number", "0x10", "number"],
  ["number", "-", "number"],
  ["boolean", false, null],
  ["checkbox", false, null],
  ["select", "option-0", null],
  ["select", "deleted", "options"],
  ["multiselect", ["option-0", "deleted"], "options"],
  ["url", { url: "https://example.com", label: "Link" }, null],
  ["url", { url: "", label: "Only a label" }, "url"],
  ["duration", { hours: "1", minutes: "30", seconds: "" }, null],
  ["duration", { hours: "1", minutes: "60", seconds: "" }, "duration"],
  ["date", "2026-02-30", "temporal"],
  ["date", "2026-10-26", null],
  ["time", "24:01", "temporal"],
  ["time", "13:45:30.5", null],
  ["datetime", "2026-10-26T13:45", null],
  ["datetime", "2026-10-26", "temporal"],
])("validates editable %s cells", (type, value, expected) => {
  expect(tableCellError(filterField(type), value, true)).toBe(expected);
});

// Test required hidden fields are validated for changed rows, while old untouched rows need no repair.
test("reports required hidden cells and accepts explicit zero or false", () => {
  const text = filterField("text");
  const required = { ...filterField("boolean"), is_required: true };
  const numeric = { ...filterField("number"), is_required: true };
  const checkbox = { ...filterField("checkbox"), is_required: true };
  const item = filterItem({ [text.id]: "Old", [numeric.id]: 0 });
  const changes = { [item.id]: { [text.id]: "New" } };
  const invalid = createTableReplacement(
    [text, required, numeric, checkbox],
    [item],
    changes,
    1,
  );
  expect(invalid.errors).toEqual([
    { itemId: item.id, fieldId: required.id, error: "required" },
  ]);
  const valid = createTableReplacement(
    [text, required, numeric, checkbox],
    [item],
    { [item.id]: { ...changes[item.id], [required.id]: false } },
    1,
  );
  expect(valid.errors).toEqual([]);
  expect(valid.input.items[0].values).toContainEqual({
    field_id: checkbox.id,
    value: false,
  });
  expect(valid.input.items[0].values).toContainEqual({
    field_id: numeric.id,
    value: 0,
  });
  expect(createTableReplacement([required], [item], {}, 1).input.items).toEqual(
    [],
  );
});

// Test returning to a baseline removes draft changes, including equivalent numeric/duration representations.
test("recognizes reverted cells without treating invalid edits as unchanged", () => {
  expect(unchangedTableCell(filterField("number"), 16, "0x10")).toBe(false);
  expect(unchangedTableCell(filterField("number"), 2, "2.0")).toBe(true);
  expect(unchangedTableCell(filterField("number"), undefined, "bad")).toBe(
    false,
  );
  expect(
    unchangedTableCell(filterField("duration"), 3600, {
      hours: "1",
      minutes: "0",
      seconds: "0",
    }),
  ).toBe(true);
  expect(
    unchangedTableCell(
      filterField("multiselect"),
      ["option-0", "option-1"],
      ["option-1", "option-0"],
    ),
  ).toBe(true);
  expect(unchangedTableCell(filterField("boolean"), undefined, false)).toBe(
    false,
  );
  expect(
    tableCellError({ ...filterField("text"), max_length: 1 }, "😀", true),
  ).toBeNull();
});
