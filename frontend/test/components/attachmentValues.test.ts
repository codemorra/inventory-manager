import { expect, test } from "vitest";
import {
  attachment,
  attachmentField,
  savedAttachment,
  savedItem,
} from "../helpers/attachments";
import {
  createCheckboxReplacement,
  createValueInput,
  getEditableValue,
  getInitialValue,
  hasRequiredItemValues,
} from "../../src/components/inventoryItemForm";
import {
  createTableReplacement,
  getTableCellValue,
} from "../../src/components/inventoryTableDraft";
import { searchInventoryItems } from "../../src/components/inventoryItemSearch";
import { sortInventoryItems } from "../../src/components/inventoryItemSorting";
import { itemFilterOperators } from "../../src/components/inventoryItemFilters";

// File IDs remain arrays through every form, checkbox shortcut, and atomic-table replacement path.
test("preserves attachment arrays and validates required file fields without coercing IDs into text", () => {
  expect(getInitialValue(attachmentField)).toEqual([]);
  expect(getEditableValue(attachmentField, [savedAttachment.id])).toEqual([
    savedAttachment.id,
  ]);
  expect(getTableCellValue(attachmentField, [savedAttachment.id])).toEqual([
    savedAttachment.id,
  ]);
  expect(createValueInput(attachmentField, [])).toBeNull();
  expect(createValueInput(attachmentField, ["new"])).toEqual({
    field_id: "files",
    value: ["new"],
  });
  expect(
    hasRequiredItemValues([{ ...attachmentField, is_required: true }], {
      files: [],
    }),
  ).toBe(false);
  expect(
    hasRequiredItemValues([{ ...attachmentField, is_required: true }], {
      files: ["new"],
    }),
  ).toBe(true);
  const checkbox = {
    ...attachmentField,
    id: "checked",
    field_type: "checkbox" as const,
  };
  expect(
    createCheckboxReplacement(
      [attachmentField, checkbox],
      savedItem,
      checkbox.id,
      true,
    ).values,
  ).toContainEqual({ field_id: "files", value: [savedAttachment.id] });
  const replacement = createTableReplacement(
    [attachmentField],
    [savedItem],
    { item: { files: ["new"] } },
    6,
  );
  expect(replacement.errors).toEqual([]);
  expect(replacement.input.items[0]!.values).toEqual([
    { field_id: "files", value: ["new"] },
  ]);
});

// Search/sorting use filenames rather than opaque technical IDs, including hidden fields.
test("searches and sorts attachment filenames while offering only meaningful presence filters", () => {
  const other = {
    ...savedItem,
    id: "other",
    values: [{ ...savedItem.values[1]!, value: ["opaque-b"] }],
    attachments: [attachment("opaque-b", { filename: "Alpha.pdf" })],
  };
  const first = {
    ...savedItem,
    attachments: [{ ...savedAttachment, filename: "Zulu.pdf" }],
  };
  expect(
    searchInventoryItems(
      [first, other],
      [attachmentField],
      "alpha",
      { yes: "Yes", no: "No" },
      "en",
    ),
  ).toEqual([other]);
  expect(
    searchInventoryItems(
      [first, other],
      [attachmentField],
      "opaque-b",
      { yes: "Yes", no: "No" },
      "en",
    ),
  ).toEqual([]);
  expect(
    sortInventoryItems([first, other], attachmentField, "ascending", "en"),
  ).toEqual([other, first]);
  expect(itemFilterOperators("attachment")).toEqual(["isEmpty", "isNotEmpty"]);
});
