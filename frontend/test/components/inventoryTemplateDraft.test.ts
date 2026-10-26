import { expect, test } from "vitest";
import {
  createTemplateDraft,
  serializeTemplateDraft,
} from "../../src/components/inventoryTemplateDraft";
import type { InventoryTemplate } from "../../src/types/inventoryTemplate";

// Adapt every field setting without sharing mutable option arrays or leaking temporary IDs on save.
test("round-trips template definitions with independent local identities and stable order", () => {
  const template: InventoryTemplate = {
    id: "template",
    name: "Structure",
    description: null,
    revision: 4,
    created_at: "",
    updated_at: "",
    fields: [
      {
        name: "Title",
        field_type: "text",
        max_length: 80,
        is_required: true,
        is_sortable: false,
        reuse_deleted_ids: false,
        options: [],
      },
      {
        name: "Choice",
        field_type: "select",
        max_length: null,
        is_required: false,
        is_sortable: true,
        reuse_deleted_ids: false,
        options: [{ name: "Repeated" }, { name: "Repeated" }],
      },
      {
        name: "Number",
        field_type: "id",
        max_length: null,
        is_required: false,
        is_sortable: true,
        reuse_deleted_ids: true,
        options: [],
      },
      {
        name: "Empty",
        field_type: "multiselect",
        max_length: null,
        is_required: true,
        is_sortable: true,
        reuse_deleted_ids: false,
        options: [],
      },
    ],
  };
  const fields = createTemplateDraft(template);
  const another = createTemplateDraft(template);
  expect(fields.map((field) => field.position)).toEqual([0, 1, 2, 3]);
  expect(fields[0]!.id).not.toBe(another[0]!.id);
  expect(fields[1]!.options[0]!.id).not.toBe(fields[1]!.options[1]!.id);
  expect(serializeTemplateDraft(fields)).toEqual(template.fields);
  fields[1]!.options[0]!.name = "Local";
  expect(template.fields[1]!.options[0]!.name).toBe("Repeated");
  expect(serializeTemplateDraft([fields[2]!, fields[0]!])).toEqual([
    template.fields[2],
    template.fields[0],
  ]);
});
