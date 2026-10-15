import { expect, test } from "vitest";
import {
  createValueInput,
  getInitialValue,
  hasRequiredItemValues,
  hasValidItemValues,
  getEditableValue,
} from "../../src/components/inventoryItemForm";
import { field } from "../helpers/inventoryDraft";
import {
  durationFromSeconds,
  emptyDuration,
  maximumDurationHours,
} from "../../src/components/duration";

// Test that required yes/no fields distinguish unset, no, and yes in the API payload.
test("keeps required booleans unset until explicitly answered", () => {
  const boolean = {
    ...field,
    field_type: "boolean" as const,
    is_required: true,
  };
  expect(getInitialValue(boolean)).toBe("");
  expect(createValueInput(boolean, "")).toBeNull();
  for (const value of [false, true]) {
    expect(hasRequiredItemValues([boolean], { [field.id]: value })).toBe(true);
    expect(createValueInput(boolean, value)).toEqual({
      field_id: field.id,
      value,
    });
  }
  expect(hasRequiredItemValues([boolean], {})).toBe(false);
  expect(hasRequiredItemValues([boolean], { [field.id]: "false" })).toBe(false);
  expect(getInitialValue({ ...boolean, is_required: false })).toBe(false);
});

// Test required empty strings and selections, while preserving valid zero and optional fields.
test("validates required text, numeric, and selection controls", () => {
  const required = { ...field, is_required: true };
  for (const value of ["", "   ", "\n"])
    expect(hasRequiredItemValues([required], { [field.id]: value })).toBe(
      false,
    );
  expect(hasRequiredItemValues([required], { [field.id]: "Title" })).toBe(true);
  expect(
    hasRequiredItemValues([{ ...required, field_type: "number" }], {
      [field.id]: "0",
    }),
  ).toBe(true);
  const multi = { ...required, field_type: "multiselect" as const };
  expect(hasRequiredItemValues([multi], {})).toBe(false);
  expect(hasRequiredItemValues([multi], { [field.id]: [] })).toBe(false);
  expect(hasRequiredItemValues([multi], { [field.id]: ["option"] })).toBe(true);
  expect(hasRequiredItemValues([field], {})).toBe(true);
});

// Test conversion and validation shared by new and existing item forms.
test("handles duration drafts without conflating omitted, zero, invalid, or stored values", () => {
  const duration = { ...field, field_type: "duration" as const };
  expect(getInitialValue(duration)).toEqual(emptyDuration());
  expect(createValueInput(duration, emptyDuration())).toBeNull();
  expect(hasValidItemValues([duration], {})).toBe(true);
  expect(hasRequiredItemValues([{ ...duration, is_required: true }], {})).toBe(
    false,
  );
  const zero = { hours: "", minutes: "", seconds: "0" };
  expect(
    hasRequiredItemValues([{ ...duration, is_required: true }], {
      [field.id]: zero,
    }),
  ).toBe(true);
  expect(createValueInput(duration, zero)).toEqual({
    field_id: field.id,
    value: 0,
  });
  const stored = durationFromSeconds(94530);
  expect(getEditableValue(duration, 94530)).toEqual(stored);
  expect(createValueInput(duration, stored)).toEqual({
    field_id: field.id,
    value: 94530,
  });
  const overflow = {
    hours: String(maximumDurationHours),
    minutes: "59",
    seconds: "59",
  };
  expect(hasValidItemValues([duration], { [field.id]: overflow })).toBe(false);
  expect(createValueInput(duration, overflow)).toBeNull();
});
