import { expect, test } from "vitest";
import {
  buildInventoryEditorInput,
  createDraftField,
  isValidFieldDraft,
} from "../../src/components/inventoryEditorDraft";
import { field, option } from "../helpers/inventoryDraft";

const inventory = { name: "Cables", description: null };

// Test that temporary identifiers never become persisted IDs in the API payload.
test("creates independent local field and option identifiers", () => {
  const a = createDraftField("inventory-1", {
    name: "Type",
    field_type: "select",
    options: [{ name: "USB" }],
  });
  const b = createDraftField("inventory-1", {
    name: "Type",
    field_type: "select",
    options: [{ name: "USB" }],
  });
  expect(a.id).not.toBe(b.id);
  expect(a.options[0]?.field_id).toBe(a.id);
  expect(a.options[0]?.id).not.toBe(b.options[0]?.id);
  const input = buildInventoryEditorInput([], [a], inventory);
  expect(input.fields).toEqual([
    {
      action: "create",
      data: { name: "Type", field_type: "select", options: [{ name: "USB" }] },
    },
  ]);
  expect(input.options).toEqual([]);
});

// Test that unchanged metadata does not create unnecessary field or option operations.
test("leaves unchanged saved configuration untouched", () => {
  expect(buildInventoryEditorInput([field], [field], inventory)).toEqual({
    inventory,
    fields: [],
    options: [],
  });
});

// Test that removing a field supersedes every staged option change below it.
test("does not emit option mutations beneath deleted fields", () => {
  const saved = {
    ...field,
    field_type: "select" as const,
    max_length: null,
    options: [option],
  };
  expect(buildInventoryEditorInput([saved], [], inventory)).toEqual({
    inventory,
    fields: [{ action: "delete", field_id: field.id }],
    options: [],
  });
});

// Test that undoing local changes results in no persistence operation.
test("omits reverted names and discarded draft options", () => {
  const saved = { ...field, options: [option] };
  const current = { ...saved, options: [{ ...option }] };
  expect(
    buildInventoryEditorInput([saved], [current], inventory).options,
  ).toEqual([]);
});

// Test the distinction between initial selection requirements and existing empty selections.
test("requires unique options on new selections but preserves existing empty selections", () => {
  const selection = createDraftField("inventory-1", {
    name: "Type",
    field_type: "select",
  });
  expect(isValidFieldDraft([], [selection])).toBe(false);
  expect(isValidFieldDraft([selection], [selection])).toBe(true);
  const duplicates = {
    ...selection,
    options: [option, { ...option, id: "other", name: "rpg" }],
  };
  expect(isValidFieldDraft([], [duplicates])).toBe(false);
  expect(isValidFieldDraft([duplicates], [duplicates])).toBe(true);
});
