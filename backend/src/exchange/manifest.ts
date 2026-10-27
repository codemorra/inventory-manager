import { z } from "zod";
import { templateFieldSchema } from "../templates/validation.js";
import { attachmentMetadataSchema } from "../attachments/validation.js";
import { inventoryCreateSchema } from "../inventories/validation.js";
import { fieldTypes } from "../db/schema.js";
import { validateValues } from "../items/validation.js";

const key = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const optionSchema = z.discriminatedUnion("available", [
  z.strictObject({ key, available: z.literal(true), name: z.string() }),
  // Deleted option names must never be resurrected by inventory exchange.
  z.strictObject({ key, available: z.literal(false), name: z.null() }),
]);
const fieldSchema = z.strictObject({
  key,
  name: z.string(),
  field_type: z.enum(fieldTypes),
  max_length: z.number().int().min(1).max(1_000).nullable(),
  is_required: z.boolean(),
  is_sortable: z.boolean(),
  reuse_deleted_ids: z.boolean(),
  last_assigned_id: safeInteger,
  options: z.array(optionSchema),
});
const fileSchema = attachmentMetadataSchema.extend({
  key,
  field: key,
  item: key,
  byte_size: safeInteger,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const manifestShape = z.strictObject({
  format: z.literal("inventory-manager"),
  version: z.literal(1),
  inventory: inventoryCreateSchema
    .pick({ name: true, description: true })
    .strict(),
  fields: z.array(fieldSchema),
  items: z.array(
    z.strictObject({
      key,
      values: z.array(
        z.strictObject({
          field: key,
          value: z.unknown().refine((v) => v !== undefined),
        }),
      ),
    }),
  ),
  attachments: z.array(fileSchema),
});

/**
 * Validate a portable saved snapshot, including references and historical saved-state exceptions.
 * @param data The versioned manifest after structural validation.
 * @param context The collector for precise manifest errors.
 */
function validateSnapshot(
  data: z.output<typeof manifestShape>,
  context: z.RefinementCtx,
) {
  const issue = (path: (string | number)[], message: string) =>
    context.addIssue({ code: "custom", path, message });
  const unique = (keys: string[], path: (string | number)[]) => {
    if (new Set(keys).size !== keys.length)
      issue(path, "Archive keys must be unique.");
  };
  unique(
    data.fields.map((f) => f.key),
    ["fields"],
  );
  unique(
    data.items.map((i) => i.key),
    ["items"],
  );
  unique(
    data.attachments.map((a) => a.key),
    ["attachments"],
  );
  unique(
    data.fields.flatMap((f) => f.options.map((o) => o.key)),
    ["fields"],
  );
  const files = new Map(data.attachments.map((file) => [file.key, file]));
  const usedFiles = new Set<string>();
  const usedOptions = new Set<string>();
  const numbers = new Map<string, Set<number>>();
  const definitions = new Map(data.fields.map((field) => [field.key, field]));
  const fields = data.fields
    .filter((f) => f.field_type !== "id")
    .map((field) => ({
      id: field.key,
      fieldType: field.field_type,
      maxLength: field.max_length,
      // Required fields may have been introduced after a saved item was created.
      isRequired: false,
    }));
  const options = data.fields.flatMap((field) =>
    field.options.map((option) => ({ id: option.key, fieldId: field.key })),
  );
  for (const [index, field] of data.fields.entries()) {
    const structural = templateFieldSchema.safeParse({
      name: field.name,
      field_type: field.field_type,
      max_length: field.max_length,
      is_required: field.is_required,
      is_sortable: field.is_sortable,
      reuse_deleted_ids: field.reuse_deleted_ids,
      options: field.options
        .filter((o) => o.available)
        .map((o) => ({ name: o.name })),
    });
    if (
      !structural.success ||
      (field.field_type !== "id" && field.last_assigned_id !== 0) ||
      (!["select", "multiselect"].includes(field.field_type) &&
        field.options.length)
    )
      issue(["fields", index], "Invalid saved field definition.");
  }
  for (const [index, item] of data.items.entries()) {
    unique(
      item.values.map((v) => v.field),
      ["items", index, "values"],
    );
    try {
      validateValues(
        item.values
          .filter((v) => definitions.get(v.field)?.field_type !== "id")
          .map((v) => ({ field_id: v.field, value: v.value })),
        fields,
        options,
      );
    } catch {
      issue(
        ["items", index, "values"],
        "A saved value does not match its field type or references.",
      );
    }
    for (const cell of item.values) {
      const field = definitions.get(cell.field);
      if (!field) continue;
      if (field.field_type === "id") {
        const value = cell.value;
        const occupied = numbers.get(field.key) ?? new Set<number>();
        if (
          typeof value !== "number" ||
          !Number.isSafeInteger(value) ||
          value < 1 ||
          value > field.last_assigned_id ||
          occupied.has(value)
        )
          issue(
            ["items", index, "values"],
            "Automatic numbers must be unique positive safe integers within their saved counter.",
          );
        else occupied.add(value);
        numbers.set(field.key, occupied);
      }
      if (field.field_type === "select" || field.field_type === "multiselect") {
        const selected = Array.isArray(cell.value) ? cell.value : [cell.value];
        for (const id of selected)
          if (typeof id === "string") usedOptions.add(id);
      }
      if (field.field_type === "attachment" && Array.isArray(cell.value)) {
        for (const id of cell.value) {
          const file = files.get(id);
          if (
            !file ||
            file.field !== field.key ||
            file.item !== item.key ||
            usedFiles.has(id)
          )
            issue(
              ["items", index, "values"],
              "Files must belong to exactly one cell and item.",
            );
          usedFiles.add(id);
        }
      }
    }
    for (const field of data.fields.filter(
      (field) => field.field_type === "id",
    ))
      if (!item.values.some((v) => v.field === field.key))
        issue(
          ["items", index, "values"],
          "Every saved item needs its automatic numbers.",
        );
  }
  for (const [index, file] of data.attachments.entries())
    if (!usedFiles.has(file.key))
      issue(
        ["attachments", index],
        "Unreferenced files are not part of an inventory archive.",
      );
  for (const [index, field] of data.fields.entries())
    if (field.options.some((o) => !o.available && !usedOptions.has(o.key)))
      issue(
        ["fields", index, "options"],
        "Unavailable options must be referenced by a saved item.",
      );
}

export const inventoryManifestSchema =
  manifestShape.superRefine(validateSnapshot);
export type InventoryManifest = z.output<typeof inventoryManifestSchema>;
