import { expect, test } from "vitest";
import {
  captureTablePresentation,
  type InventoryTablePresentation,
} from "../../src/components/inventoryTablePresentation";
import { filterField, filterRule } from "../helpers/itemFilters";

// Test configuration changes during loading cannot leave all fields hidden or obsolete rules active.
test("captures a private view and repairs references against freshly loaded fields", () => {
  const text = filterField("text");
  const number = filterField("number");
  const presentation: InventoryTablePresentation = {
    view: {
      version: 1,
      sort: { fieldId: text.id, direction: "ascending" },
      hiddenFieldIds: [text.id, number.id],
      columnWidths: { [number.id]: 180 },
      wrapText: true,
      attachmentPreviews: false,
    },
    searchQuery: "yes",
    filters: [
      filterRule(text, { value: "Old" }),
      filterRule(number, { id: "number-rule", value: "2" }),
    ],
    locale: "en",
    booleanLabels: { yes: "Yes", no: "No" },
  };
  const snapshot = captureTablePresentation(presentation, [number]);
  expect(snapshot.view.hiddenFieldIds).toEqual([]);
  expect(snapshot.view.sort).toBeNull();
  expect(snapshot.filters.map((filter) => filter.fieldId)).toEqual([number.id]);
  presentation.view.columnWidths[number.id] = 900;
  presentation.booleanLabels.yes = "Ja";
  presentation.filters[1].value = "100";
  expect(snapshot.view.columnWidths[number.id]).toBe(180);
  expect(snapshot.booleanLabels.yes).toBe("Yes");
  expect(snapshot.filters[0].value).toBe("2");
});
