import assert from "node:assert/strict";
import test from "node:test";
import { ZodError } from "zod";
import type {
  inventoryFields,
  inventoryFieldOptions,
} from "../src/db/schema.js";
import { DomainError } from "../src/errors.js";
import { itemInputSchema, validateValues } from "../src/items/validation.js";
import {
  InvalidTemporalValueError,
  validateTemporalValue,
} from "../src/items/temporal.js";

const lifecycle = {
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  deletedAt: null,
};
const field: typeof inventoryFields.$inferSelect = {
  ...lifecycle,
  id: "field",
  inventoryId: "inventory",
  name: "Field",
  fieldType: "text",
  maxLength: 3,
  position: 0,
};
const option: typeof inventoryFieldOptions.$inferSelect = {
  ...lifecycle,
  id: "option",
  fieldId: "field",
  name: "Option",
  position: 0,
};

// Tests for inventory item value validation
test("item validation rejects invalid values, duplicate/unknown fields, and omitted value properties", () => {
  assert.deepEqual(itemInputSchema.parse({ ignored: true }), { values: [] });
  for (const input of [
    { values: null },
    { values: [{}] },
    { values: [{ field_id: "field" }] },
  ]) {
    assert.throws(() => itemInputSchema.parse(input), ZodError);
  }
  const invalid: [typeof field.fieldType, unknown][] = [
    ["text", "long"],
    ["text", false],
    ["text", null],
    ["number", "1"],
    ["number", true],
    ["number", Number.NaN],
    ["number", Infinity],
    ["boolean", 1],
    ["boolean", "false"],
    ["duration", -1],
    ["duration", 1.5],
    ["duration", true],
    ["date", 20260101],
    ["date", "not-a-date"],
    ["time", null],
    ["time", "25:00"],
    ["datetime", false],
    ["datetime", "2026-02-30T12:00"],
    ["select", ["option"]],
    ["select", "missing"],
    ["multiselect", []],
    ["multiselect", "option"],
    ["multiselect", ["option", "missing"]],
  ];
  const expectedError = (error: unknown) =>
    error instanceof DomainError &&
    error.code === "invalid_inventory_item_value";
  for (const [fieldType, value] of invalid) {
    assert.throws(
      () =>
        validateValues(
          [{ field_id: field.id, value }],
          [{ ...field, fieldType }],
          [option],
        ),
      expectedError,
      `${fieldType}: ${String(value)}`,
    );
  }
  for (const values of [
    [{ field_id: "missing", value: "x" }],
    [
      { field_id: field.id, value: "a" },
      { field_id: field.id, value: "b" },
    ],
  ]) {
    assert.throws(
      () => validateValues(values, [field], [option]),
      expectedError,
    );
  }
  // Text values are not trimmed, and Unicode lengths count code points.
  validateValues([{ field_id: field.id, value: "😀😀😀" }], [field], []);
  validateValues([{ field_id: field.id, value: "   " }], [field], []);
});

// Tests for temporal value validation
test("temporal validation preserves calendar/week dates, basic times, fractions, offsets, and local datetimes", () => {
  const valid: Record<"date" | "time" | "datetime", string[]> = {
    date: [
      "2024-02-29",
      "20261013",
      "2026-W42-2",
      "2026W422",
      "2026-W42",
      "2020-W53-7",
      "0001-01-01",
    ],
    time: [
      "12",
      "12:30",
      "123000",
      "T12:30:00",
      "12:30:00.1234567",
      "12:30:00,5",
      "12:30Z",
      "12:30+02:00",
      "12+00:90",
      "12:30:00-00:30:00.5",
      "24:00",
      "240000.0000001",
    ],
    datetime: [
      "2026-10-13",
      "20261013T123000",
      "2026-10-13T12:30",
      "2026-10-13 12:30:00.123456+02:00",
      "2026-W42T12",
      "2026W422T12:30Z",
      "2026-10-13😀12:30",
      "2026-10-13T24:00",
    ],
  };
  const invalid: typeof valid = {
    date: [
      "",
      "bad",
      "2023-02-29",
      "2026-04-31",
      "2026-00-01",
      "0000-01-01",
      "2025-W53-1",
      "2026-W42-8",
      "9999-W52-7",
      "2026-10-13\n",
    ],
    time: [
      "24:01",
      "12:60",
      "12:30:60",
      "12.5",
      "12:30.5",
      "t12:30",
      "12:30:00.",
      "12+24:00",
      "12Zx",
      "12:30\n",
    ],
    datetime: [
      "2026-10",
      "2026-10-13T",
      "2026-10-13TT12:30",
      "2026-10-13T24:01",
      "9999-12-31T24:00",
      "2026-10-13T12:30\n",
    ],
  };
  for (const type of ["date", "time", "datetime"] as const) {
    for (const value of valid[type])
      assert.doesNotThrow(
        () => validateTemporalValue(type, value),
        `${type}: ${value}`,
      );
    for (const value of invalid[type])
      assert.throws(
        () => validateTemporalValue(type, value),
        InvalidTemporalValueError,
        `${type}: ${value}`,
      );
  }
});
