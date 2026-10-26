import { expect, test } from "vitest";
import {
  defaultColumnWidth,
  distributeColumnWidths,
} from "../../src/appearance/inventoryColumns";

// Test short IDs are sized by their heading/content rather than a generic minimum or spare space.
test("keeps ID defaults compact while fitting titles such as Quantity", () => {
  const id = defaultColumnWidth(
    { name: "ID", field_type: "id", is_sortable: true },
    ["1", "9"],
  );
  const quantity = defaultColumnWidth(
    { name: "Quantity", field_type: "number", is_sortable: true },
    ["1", "12"],
  );
  expect(id).toBeLessThan(96);
  expect(quantity).toBeGreaterThan(id);
  expect(quantity).toBeGreaterThanOrEqual("QUANTITY".length * 8 + 40);
});

// Test ordinary values influence sizing while exceptionally long values do not dominate the table.
test("fits displayed values up to a cap without capping a longer heading", () => {
  const field = {
    name: "Cable",
    field_type: "text",
    is_sortable: true,
  } as const;
  const short = defaultColumnWidth(field, ["USB-C"]);
  const longer = defaultColumnWidth(field, ["DisplayPort to DisplayPort"]);
  expect(longer).toBeGreaterThan(short);
  expect(defaultColumnWidth(field, ["x".repeat(1000)])).toBe(320);
  expect(
    defaultColumnWidth({ ...field, name: "Long heading ".repeat(5) }, ["x"]),
  ).toBeGreaterThan(320);
});

// Test only Auto columns absorb surplus while manual bases remain unchanged.
test("assigns surplus to Auto columns and removes it before horizontal overflow", () => {
  const bases = [120, 100, 200];
  const automatic = [false, true, true];
  expect(distributeColumnWidths(bases, 720, automatic)).toEqual([
    120, 250, 350,
  ]);
  expect(distributeColumnWidths(bases, 620, automatic)).toEqual([
    120, 200, 300,
  ]);
  expect(distributeColumnWidths(bases, 420, automatic)).toEqual(bases);
  expect(distributeColumnWidths(bases, 300, automatic)).toEqual(bases);
  expect(bases).toEqual([120, 100, 200]);
});

// Test all-manual inventories still fill the viewport without changing persisted bases.
test("falls back to sharing surplus across all columns when every column is manual", () => {
  const bases = [120, 100, 200];
  expect(distributeColumnWidths(bases, 720, [false, false, false])).toEqual([
    220, 200, 300,
  ]);
  expect(distributeColumnWidths(bases, 300, [false, false, false])).toEqual(
    bases,
  );
  expect(bases).toEqual([120, 100, 200]);
});

// Test a single Auto column absorbs all spare pixels without rounding gaps or changing the other bases.
test("allocates the full remainder to the eligible columns", () => {
  expect(
    distributeColumnWidths([60, 200, 100], 662, [false, true, false]),
  ).toEqual([60, 502, 100]);
  const widths = distributeColumnWidths([60, 200, 100], 662, [
    true,
    false,
    true,
  ]);
  expect(widths[1]).toBe(200);
  expect(widths.reduce((sum, width) => sum + width, 0)).toBe(662);
});
