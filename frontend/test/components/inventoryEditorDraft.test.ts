import { expect, test } from "vitest";
import {
  buildInventoryEditorInput,
  createDraftField,
  isValidFieldDraft,
  moveDraftField,
} from "../../src/components/inventoryEditorDraft";
import { field, option } from "../helpers/inventoryDraft";

const inventory = { name: "Cables", description: null };

// Test local automatic field configuration survives creation, editing, and undo without counter data.
test("serializes automatic numbering preferences without client-owned assignments", () => {
  const automatic = createDraftField(field.inventory_id, {
    name: "Reference",
    field_type: "id",
  });
  expect(automatic.reuse_deleted_ids).toBe(false);
  expect(buildInventoryEditorInput([], [automatic], inventory).fields).toEqual([
    {
      action: "create",
      data: {
        name: "Reference",
        field_type: "id",
        is_required: false,
        is_sortable: true,
        reuse_deleted_ids: false,
      },
    },
  ]);
  const updated = { ...automatic, reuse_deleted_ids: true };
  expect(
    buildInventoryEditorInput([automatic], [updated], inventory).fields,
  ).toEqual([
    {
      action: "update",
      field_id: automatic.id,
      data: { reuse_deleted_ids: true },
    },
  ]);
  expect(
    buildInventoryEditorInput([automatic], [automatic], inventory).fields,
  ).toEqual([]);
});

// Test insertion relative to targets in either direction without mutating saved definitions.
test.each([
  ["a", "c", "after", ["b", "c", "a"]],
  ["c", "a", "before", ["c", "a", "b"]],
  ["a", "c", "before", ["b", "a", "c"]],
  ["c", "a", "after", ["a", "c", "b"]],
] as const)("moves %s %s (%s)", (source, target, side, expected) => {
  const original = ["a", "b", "c"].map((id, position) => ({
    ...field,
    id,
    position: position + 3,
  }));
  const before = structuredClone(original);
  const result = moveDraftField(original, source, target, side);
  expect(result.map((entry) => entry.id)).toEqual(expected);
  expect(result.map((entry) => entry.position)).toEqual([0, 1, 2]);
  expect(
    result.every(
      (entry) =>
        entry.options ===
        original.find((saved) => saved.id === entry.id)?.options,
    ),
  ).toBe(true);
  expect(original).toEqual(before);
});

// Test unknown, self, and unchanged insertions leave the original array intact.
test("ignores no-op and invalid field moves", () => {
  const original = [
    { ...field, id: "a" },
    { ...field, id: "b" },
  ];
  expect(moveDraftField(original, "a", "b", "before")).toBe(original);
  expect(moveDraftField(original, "b", "a", "after")).toBe(original);
  expect(moveDraftField(original, "a", "a", "after")).toBe(original);
  expect(moveDraftField(original, "missing", "b", "before")).toBe(original);
  expect(moveDraftField(original, "a", "missing", "before")).toBe(original);
});

// Test exact saved references and omission of order operations after reverting the draft.
test("serializes a complete order only when surviving fields were reordered", () => {
  const other = { ...field, id: "other" };
  const original = [field, other];
  const moved = moveDraftField(original, other.id, field.id, "before");
  expect(buildInventoryEditorInput(original, moved, inventory)).toEqual({
    inventory,
    fields: [],
    options: [],
    field_order: [{ field_id: other.id }, { field_id: field.id }],
  });
  const reverted = moveDraftField(moved, field.id, other.id, "before");
  expect(buildInventoryEditorInput(original, reverted, inventory)).toEqual({
    inventory,
    fields: [],
    options: [],
  });
});

// Test new temporary IDs are references only, including deletions and other field setting edits.
test("references new fields in the order without submitting deleted fields or individual positions", () => {
  const removed = { ...field, id: "removed" };
  const fresh = createDraftField(field.inventory_id, {
    name: "Fresh",
    is_required: true,
    is_sortable: false,
  });
  const current = [fresh, { ...field, name: "Changed" }];
  const result = buildInventoryEditorInput(
    [field, removed],
    current,
    inventory,
  );
  expect(result.field_order).toEqual([
    { client_id: fresh.id },
    { field_id: field.id },
  ]);
  expect(result.fields).toEqual([
    { action: "delete", field_id: removed.id },
    {
      action: "create",
      client_id: fresh.id,
      data: {
        name: "Fresh",
        field_type: "text",
        max_length: 255,
        is_required: true,
        is_sortable: false,
      },
    },
    { action: "update", field_id: field.id, data: { name: "Changed" } },
  ]);
});

// Test pure append operations and reordered all-new drafts already encode their order in creation.
test("retains append behavior without unnecessary client identifiers or order changes", () => {
  const a = createDraftField(field.inventory_id, { name: "First" });
  const b = createDraftField(field.inventory_id, { name: "Second" });
  for (const current of [
    [field, a, b],
    [field, b, a],
  ]) {
    const result = buildInventoryEditorInput([field], current, inventory);
    expect(result.field_order).toBeUndefined();
    expect(result.fields).toHaveLength(2);
    expect(
      result.fields.every(
        (change) =>
          change.action === "create" && change.client_id === undefined,
      ),
    ).toBe(true);
    expect(
      result.fields.map((change) =>
        change.action === "create" ? change.data.name : "",
      ),
    ).toEqual(current.slice(1).map((entry) => entry.name));
  }
});

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
      data: {
        name: "Type",
        field_type: "select",
        options: [{ name: "USB" }],
        is_required: false,
        is_sortable: true,
      },
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

// Test explicit default values and persisted changes in either boolean direction.
test("serializes field flags while omitting reverted settings", () => {
  const configured = createDraftField("inventory-1", {
    name: "Title",
    is_required: true,
    is_sortable: false,
  });
  expect(configured).toMatchObject({ is_required: true, is_sortable: false });
  expect(buildInventoryEditorInput([], [configured], inventory).fields).toEqual(
    [
      {
        action: "create",
        data: {
          name: "Title",
          field_type: "text",
          max_length: 255,
          is_required: true,
          is_sortable: false,
        },
      },
    ],
  );
  const changed = { ...field, is_required: true, is_sortable: false };
  expect(
    buildInventoryEditorInput([field], [changed], inventory).fields,
  ).toEqual([
    {
      action: "update",
      field_id: field.id,
      data: { is_required: true, is_sortable: false },
    },
  ]);
  expect(
    buildInventoryEditorInput([changed], [field], inventory).fields,
  ).toEqual([
    {
      action: "update",
      field_id: field.id,
      data: { is_required: false, is_sortable: true },
    },
  ]);
  expect(
    buildInventoryEditorInput(
      [field],
      [{ ...changed, is_required: false, is_sortable: true }],
      inventory,
    ).fields,
  ).toEqual([]);
});
