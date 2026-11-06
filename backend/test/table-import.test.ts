import assert from "node:assert/strict";
import test from "node:test";
import { ZodError } from "zod";
import {
  parseInventoryTable,
  TableParseError,
  type InventoryTable,
} from "../src/exchange/table-reader.js";
import { validateTableMapping } from "../src/exchange/table-validation.js";
import { inventoryManifestSchema } from "../src/exchange/manifest.js";
import type { TableExportFormat } from "../src/exchange/table.js";

/** Read synthetic foreign tables without accessing a database or application storage. */
function read(
  source: string,
  format: TableExportFormat = "csv",
  delimiter: "," | ";" | "\t" = ",",
) {
  return parseInventoryTable(Buffer.from(source), format, delimiter);
}

/** Require stable structural error codes rather than decoder-specific messages. */
function rejects(
  source: string,
  format: TableExportFormat,
  code: TableParseError["code"],
) {
  assert.throws(
    () => read(source, format),
    (error: unknown) => error instanceof TableParseError && error.code === code,
  );
}

// CSV syntax is independent of field types; quoted values preserve embedded separators and physical newlines.
test("reads foreign CSV quoting, BOM, empty cells, blank lines and multiline records", () => {
  assert.deepEqual(
    read(
      '\ufeff\r\nPart,Notes,Empty\r\n"Prüfung, A","One\r\nTwo; and ""quotes""",\r\n\r\n"","",last\r\n',
    ),
    {
      headers: ["Part", "Notes", "Empty"],
      rows: [
        ["Prüfung, A", 'One\r\nTwo; and "quotes"', ""],
        ["", "", "last"],
      ],
    },
  );
  assert.deepEqual(read('A;B\n"x;y"; z', "csv", ";"), {
    headers: ["A", "B"],
    rows: [["x;y", " z"]],
  });
  assert.deepEqual(read("A\tB\r1\t2\r", "csv", "\t"), {
    headers: ["A", "B"],
    rows: [["1", "2"]],
  });
  assert.deepEqual(read('A\n""\n\n'), { headers: ["A"], rows: [[""]] });
  assert.deepEqual(read("A,B"), { headers: ["A", "B"], rows: [] });
  assert.deepEqual(read("A,B\nx,"), { headers: ["A", "B"], rows: [["x", ""]] });
});

// Malformed CSV must not be silently repaired into a differently shaped table.
test("rejects invalid CSV quoting, inconsistent columns, empty files and invalid UTF-8", () => {
  for (const source of ['A\n"unfinished', 'A\nx"y', 'A\n"x"tail', 'A\n"x" '])
    rejects(source, "csv", "invalid_csv");
  for (const source of ["A,B\nx", "A\nx,y", "A,B\n1,2,3"])
    rejects(source, "csv", "inconsistent_table_columns");
  for (const source of ["", "\ufeff", '""', ",", " \n"])
    rejects(source, "csv", "empty_table");
  assert.throws(
    () => parseInventoryTable(Uint8Array.from([0xff]), "csv"),
    (error: unknown) =>
      error instanceof TableParseError &&
      error.code === "invalid_table_encoding",
  );
});

// Pipe tables accept optional outer delimiters; text escapes are decoded once without executing HTML.
test("reads Markdown alignment, escaped pipes, backslashes, entities and explicit line breaks", () => {
  assert.deepEqual(
    read(
      String.raw`
| Name \| Label | Text |
| :--- | ---: |
| A\|B | &lt;br&gt; &amp; &#124; &#x1f600; &amp;lt; <br>next |
| C\\ | \*literal\* \q |

`,
      "markdown",
    ),
    {
      headers: ["Name | Label", "Text"],
      rows: [
        ["A|B", "<br> & | 😀 &lt; \nnext"],
        ["C\\", "*literal* \\q"],
      ],
    },
  );
  assert.deepEqual(read("A | B\n--- | :---:\nx | y", "markdown"), {
    headers: ["A", "B"],
    rows: [["x", "y"]],
  });
  assert.deepEqual(read("| A | B |\n| --- | --- |\n| x | |", "markdown"), {
    headers: ["A", "B"],
    rows: [["x", ""]],
  });
  assert.deepEqual(read("| A |\n| --- |\n| --- |", "markdown"), {
    headers: ["A"],
    rows: [["---"]],
  });
  assert.deepEqual(read("| A |\n| --- |", "markdown"), {
    headers: ["A"],
    rows: [],
  });
});

// Markdown imports contain only one rectangular table, with no headings, fenced blocks or surrounding prose.
test("rejects Markdown documents with extra content, extra tables or invalid table structure", () => {
  for (const source of [
    "",
    "# Heading\n\n| A |\n| --- |",
    "| A |\n| --- |\nTrailing prose",
    "| A |\n| -- |",
    "| A |\n| value |",
    "| A |\n| --- |\n\n| B |\n| --- |",
    "A\n---\nx",
    "| A |\n| --- |\n\n| x |",
    "```\n| A |\n| --- |\n```",
  ])
    rejects(source, "markdown", "invalid_markdown_table");
  rejects(
    "| A | B |\n| --- | --- |\n| x |",
    "markdown",
    "inconsistent_table_columns",
  );
});

// Preview limits are enforced during record collection rather than after retaining arbitrarily large row arrays.
test("bounds table columns, rows and total cells", () => {
  rejects(
    Array.from({ length: 1_001 }, () => "A").join(","),
    "csv",
    "table_too_large",
  );
  rejects(
    "| " + Array.from({ length: 1_001 }, () => "A").join(" | ") + " |\n| --- |",
    "markdown",
    "table_too_large",
  );
  rejects("A\n" + "x\n".repeat(100_001), "csv", "table_too_large");
  const row = Array.from({ length: 1_000 }, () => "x").join(",") + "\n";
  rejects(row.repeat(1_001), "csv", "table_too_large");
});

// Generic tables are not assumed to be inventory exports: text retains identifiers and arbitrary selection-like syntax.
test("imports literal text unchanged and only converts explicitly selected columns", () => {
  const table = read(
    'Code,Quantity,Choices,Enabled,Skip\n00123,0,USB; Power,false,x\n  text  ,,,true,y\n"[""USB"",""Power""]",  ,Office; Workshop,,z',
  );
  const result = validateTableMapping(table, [
    { column: 3, name: "Enabled", field_type: "boolean" },
    { column: 0, name: "Code", field_type: "text" },
    { column: 1, name: "Quantity", field_type: "number" },
    { column: 2, name: "Choices", field_type: "text" },
  ]);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(
    result.fields.map((field) => [field.key, field.name, field.max_length]),
    [
      ["f1", "Code", 1_000],
      ["f2", "Quantity", null],
      ["f3", "Choices", 1_000],
      ["f4", "Enabled", null],
    ],
  );
  assert.deepEqual(
    result.items.map((item) => item.values),
    [
      [
        { field: "f1", value: "00123" },
        { field: "f2", value: 0 },
        { field: "f3", value: "USB; Power" },
        { field: "f4", value: false },
      ],
      [
        { field: "f1", value: "  text  " },
        { field: "f4", value: true },
      ],
      [
        { field: "f1", value: '["USB","Power"]' },
        { field: "f3", value: "Office; Workshop" },
      ],
    ],
  );
  assert.ok(
    inventoryManifestSchema.safeParse({
      format: "inventory-manager",
      version: 1,
      inventory: { name: "Imported", description: null },
      fields: result.fields,
      items: result.items,
      attachments: [],
    }).success,
  );
});

// Scalar conversion is constrained by existing domain rules rather than JavaScript truthiness or locale guessing.
test("converts numbers, booleans, temporal values, durations and common URL representations", () => {
  const cases = [
    ["number", "-1.25e2", -125],
    ["number", "00123", 123],
    ["checkbox", "false", false],
    ["date", "2024-02-29", "2024-02-29"],
    ["time", "12:34:56Z", "12:34:56Z"],
    ["datetime", "2026-11-06T12:34", "2026-11-06T12:34"],
    ["duration", "61", 61],
    ["duration", "0", 0],
    ["url", "https://example.com/a_(b)", { url: "https://example.com/a_(b)" }],
    [
      "url",
      "[Example](https://example.com/a_(b))",
      { label: "Example", url: "https://example.com/a_(b)" },
    ],
    [
      "url",
      "Example (nested) (https://example.org)",
      { label: "Example (nested)", url: "https://example.org" },
    ],
  ] as const;
  for (const [type, source, expected] of cases) {
    const result = validateTableMapping(
      { headers: ["Value"], rows: [[source]] },
      [{ column: 0, name: "Value", field_type: type }],
    );
    assert.equal(result.valid, true, `${type}: ${source}`);
    if (result.valid)
      assert.deepEqual(result.items[0]!.values[0]!.value, expected);
  }
});

// Source coordinates include rows outside a short visual preview and columns omitted by other mappings.
test("reports every invalid cell and allows switching types or skipping problematic columns", () => {
  const table: InventoryTable = {
    headers: ["Skip", "Quantity", "Date"],
    rows: Array.from({ length: 25 }, () => ["ignored", "1", "2026-11-06"]),
  };
  table.rows[0]![1] = "unknown";
  table.rows[24] = ["ignored", "1,5", "2026-02-30"];
  assert.deepEqual(
    validateTableMapping(table, [
      { column: 1, name: "Quantity", field_type: "number" },
      { column: 2, name: "Date", field_type: "date" },
    ]),
    {
      valid: false,
      issues: [
        { row: 0, column: 1, code: "invalid_value" },
        { row: 24, column: 1, code: "invalid_value" },
        { row: 24, column: 2, code: "invalid_value" },
      ],
    },
  );
  assert.equal(
    validateTableMapping(table, [
      { column: 1, name: "Quantity", field_type: "text" },
    ]).valid,
    true,
  );
});

// Invalid values stay errors rather than being truncated, coerced from truthy strings or interpreted as hexadecimal.
test("rejects invalid scalar values and enforces text limits by Unicode character count", () => {
  const cases = [
    ["number", "0x10"],
    ["number", "Infinity"],
    ["number", "1e999"],
    ["number", "12kg"],
    ["number", "1_000"],
    ["boolean", "yes"],
    ["checkbox", "1"],
    ["boolean", "False"],
    ["date", "31.12.2026"],
    ["time", "25:00"],
    ["datetime", "not a date"],
    ["duration", "-1"],
    ["duration", "1.5"],
    ["duration", "9007199254740992"],
    ["url", "javascript:alert(1)"],
    ["url", "Example (https://)"],
    ["text", "😀".repeat(1_001)],
  ] as const;
  for (const [type, value] of cases)
    assert.deepEqual(
      validateTableMapping({ headers: ["Value"], rows: [[value]] }, [
        { column: 0, name: "Value", field_type: type },
      ]),
      { valid: false, issues: [{ row: 0, column: 0, code: "invalid_value" }] },
      `${type}: ${value.slice(0, 30)}`,
    );
  assert.equal(
    validateTableMapping({ headers: ["Text"], rows: [["😀".repeat(1_000)]] }, [
      { column: 0, name: "Text", field_type: "text" },
    ]).valid,
    true,
  );
});

// The file delimiter and each selected cell delimiter are independent; single choices retain punctuation literally.
test("splits multiple choices by their explicit per-column separator without treating delimiters as regex", () => {
  const table = read(
    'Kind;Ports;Locations\n"Office; Workshop";" USB ; ; Power; USB; ";"A,B | C;D"\nOther;USB;"C;D"\n;;\n',
    "csv",
    ";",
  );
  const result = validateTableMapping(table, [
    { column: 0, name: "Kind", field_type: "select" },
    { column: 1, name: "Ports", field_type: "multiselect" },
    { column: 2, name: "Locations", field_type: "multiselect", separator: "|" },
  ]);
  assert.equal(result.valid, true);
  if (!result.valid) return;
  assert.deepEqual(
    result.fields.map((field) => field.options.map((option) => option.name)),
    [
      ["Office; Workshop", "Other"],
      ["USB", "Power"],
      ["A,B", "C;D"],
    ],
  );
  assert.deepEqual(
    result.items[0]!.values[1]!.value,
    result.fields[1]!.options.map((option) => option.key),
  );
  assert.deepEqual(result.items[1]!.values[2]!.value, [
    result.fields[2]!.options[1]!.key,
  ]);
  assert.deepEqual(result.items[2]!.values, []);
  const keys = result.fields.flatMap((field) =>
    field.options.map((option) => option.key),
  );
  assert.equal(new Set(keys).size, keys.length);
  const literal = validateTableMapping(
    { headers: ["Choices"], rows: [["A.*B.*C"]] },
    [
      {
        column: 0,
        name: "Choices",
        field_type: "multiselect",
        separator: ".*",
      },
    ],
  );
  assert.equal(literal.valid, true);
  if (literal.valid)
    assert.deepEqual(
      literal.fields[0]!.options.map((option) => option.name),
      ["A", "B", "C"],
    );
});

// Arbitrary Markdown tables use exactly the same explicit column interpretation as CSV files.
test("maps a foreign Markdown multiple-choice column with semicolon-separated names", () => {
  const result = validateTableMapping(
    read("| Ports |\n| --- |\n| USB; Power |\n| Power |", "markdown"),
    [{ column: 0, name: "Ports", field_type: "multiselect" }],
  );
  assert.equal(result.valid, true);
  if (result.valid)
    assert.deepEqual(
      result.fields[0]!.options.map((option) => option.name),
      ["USB", "Power"],
    );
});

// Invalid inferred options identify the source cell and cannot leak partial names into later rows.
test("reports option conflicts, name limits and option-count limits without partial cell inference", () => {
  const mapping = [{ column: 0, name: "Choices", field_type: "multiselect" }];
  assert.deepEqual(
    validateTableMapping(
      { headers: ["Choices"], rows: [["One"], ["one"]] },
      mapping,
    ),
    {
      valid: false,
      issues: [{ row: 1, column: 0, code: "conflicting_option_name" }],
    },
  );
  const names = Array.from({ length: 100 }, (_, index) => `Option ${index}`);
  assert.deepEqual(
    validateTableMapping(
      {
        headers: ["Choices"],
        rows: [["Leaked;" + "x".repeat(256)], [names.join(";")]],
      },
      mapping,
    ),
    {
      valid: false,
      issues: [{ row: 0, column: 0, code: "invalid_option_name" }],
    },
  );
  assert.deepEqual(
    validateTableMapping(
      { headers: ["Choices"], rows: [[names.join(";")], ["Overflow"]] },
      mapping,
    ),
    {
      valid: false,
      issues: [{ row: 1, column: 0, code: "too_many_options" }],
    },
  );
  assert.deepEqual(
    validateTableMapping({ headers: ["Choices"], rows: [[" ; ; "]] }, mapping),
    {
      valid: false,
      issues: [{ column: 0, code: "missing_options" }],
    },
  );
});

// Configuration errors are separate from cell errors; skipped columns are omitted from the mapping array.
test("rejects invalid field names, types, column references and inappropriate separator settings", () => {
  const table = read("A,B\nx,y");
  const valid = { column: 0, name: "A", field_type: "text" };
  for (const mappings of [
    [],
    [valid, valid],
    [{ ...valid, column: 2 }],
    [{ ...valid, column: -1 }],
    [{ ...valid, column: "0" }],
    [{ ...valid, name: " " }],
    [{ ...valid, name: "x".repeat(256) }],
    [{ ...valid, field_type: "id" }],
    [{ ...valid, field_type: "attachment" }],
    [{ ...valid, extra: true }],
    [{ ...valid, separator: ";" }],
    [{ ...valid, field_type: "multiselect", separator: "" }],
    [{ ...valid, field_type: "multiselect", separator: "x".repeat(17) }],
  ])
    assert.throws(() => validateTableMapping(table, mappings), ZodError);
  const result = validateTableMapping(read("A,B"), [valid]);
  assert.equal(result.valid, true);
  if (result.valid) assert.deepEqual(result.items, []);
});
