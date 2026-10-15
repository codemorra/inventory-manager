import assert from "node:assert/strict";
import test from "node:test";
import {
  inventoryCreateSchema,
  inventoryUpdateSchema,
} from "../src/inventories/validation.js";
import {
  fieldCreateSchema,
  fieldUpdateSchema,
} from "../src/fields/validation.js";
import {
  optionCreateSchema,
  optionUpdateSchema,
} from "../src/options/validation.js";

// Test suite for validating name normalization, code-point limits, optional values, and integer coercion.
test("preserves name normalization, code-point limits, optional values, and integer coercion", () => {
  assert.deepEqual(
    inventoryCreateSchema.parse({
      name: "\u0085 Tools \u001c",
      description: "  unchanged  ",
      ignored: true,
    }),
    { name: "Tools", description: "  unchanged  " },
  );
  assert.equal(
    inventoryCreateSchema.parse({ name: "😀".repeat(255) }).name,
    "😀".repeat(255),
  );
  assert.equal(inventoryCreateSchema.parse({ name: "\ufeff" }).name, "\ufeff");
  for (const name of [
    "",
    " \u0085\u001c",
    "x".repeat(256),
    ` ${"x".repeat(255)}`,
  ]) {
    assert.equal(
      inventoryCreateSchema.safeParse({ name }).success,
      false,
      JSON.stringify(name),
    );
  }
  assert.deepEqual(inventoryUpdateSchema.parse({ name: null }), { name: null });
  assert.deepEqual(inventoryUpdateSchema.parse({ description: null }), {
    description: null,
  });
  assert.deepEqual(optionUpdateSchema.parse({ ignored: "value" }), {});
  assert.deepEqual(optionCreateSchema.parse({ name: "  Ready  " }), {
    name: "Ready",
  });
  for (const [input, output] of [
    ["2", 2],
    ["1.0", 1],
    ["1_000", 1000],
    [true, 1],
    [false, 0],
    [null, null],
  ] as const) {
    assert.equal(fieldUpdateSchema.parse({ position: input }).position, output);
  }
  for (const position of [-1, 1.5, "", "1e2", [], {}]) {
    assert.equal(
      fieldUpdateSchema.safeParse({ position }).success,
      false,
      JSON.stringify(position),
    );
  }
  assert.deepEqual(
    fieldUpdateSchema.parse({
      field_type: "number",
      max_length: 12,
      options: [],
    }),
    {},
  );
});

// Test suite for validating field configuration and case-folded initial options in a compact matrix.
test("validates field configuration and case-folded initial options in a compact matrix", () => {
  for (const field_type of [
    "text",
    "number",
    "boolean",
    "date",
    "time",
    "datetime",
    "duration",
    "select",
    "multiselect",
    "url",
  ]) {
    const options =
      field_type === "select" || field_type === "multiselect"
        ? [{ name: " First " }]
        : [];
    const field = fieldCreateSchema.parse({
      name: "Field",
      field_type,
      options,
    });
    assert.equal(field.max_length, field_type === "text" ? 255 : null);
    assert.equal(field.field_type, field_type);
    assert.deepEqual(field.options, options.length ? [{ name: "First" }] : []);
  }
  assert.equal(
    fieldCreateSchema.parse({ name: "Text", max_length: "10000" }).max_length,
    10000,
  );
  assert.equal(
    fieldCreateSchema.parse({ name: "Text", max_length: null }).max_length,
    255,
  );
  const invalid = [
    { field_type: "invalid" },
    { max_length: 0 },
    { max_length: 10001 },
    { field_type: "number", max_length: 10 },
    { field_type: "boolean", options: [{ name: "Yes" }] },
    { field_type: "select" },
    { field_type: "multiselect", options: [] },
    { field_type: "select", options: [{ name: "PC" }, { name: " pc " }] },
    {
      field_type: "select",
      options: [{ name: "Straße" }, { name: "STRASSE" }],
    },
    { field_type: "multiselect", options: [{ name: "Σ" }, { name: "ς" }] },
    { field_type: "select", options: [{ name: "ﬃ" }, { name: "FFI" }] },
    {
      field_type: "select",
      options: Array.from({ length: 101 }, (_, index) => ({
        name: `Option ${index}`,
      })),
    },
  ];
  for (const configuration of invalid) {
    assert.equal(
      fieldCreateSchema.safeParse({ name: "Field", ...configuration }).success,
      false,
      JSON.stringify(configuration),
    );
  }
});
