import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough, Readable } from "node:stream";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import { readExportSnapshot } from "../src/exchange/snapshot.js";
import { importSessionLifetime } from "../src/exchange/limits.js";
import { maxTableBytes } from "../src/exchange/table-reader.js";
import {
  inventories,
  inventoryFields,
  inventoryItems,
  inventoryItemValues,
  inventoryFieldOptions,
} from "../src/db/schema.js";

/** Use only temporary storage and an in-memory migrated database for real public API and lifecycle checks. */
async function fixture(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "table-import-test-"));
  const connection = openDatabase(":memory:");
  const services = createServices(connection.db, { directory });
  const errors: unknown[] = [];
  const api = request(
    createApp({ error: (...args: unknown[]) => errors.push(args) }, services),
  );
  context.after(async () => {
    await services.imports!.reset();
    connection.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    ...connection,
    directory,
    services,
    tables: services.imports!.tables,
    api,
    errors,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const path = "/inventory-table-imports";
const textColumns = [{ column: 0, name: "Value", field_type: "text" }];

/** Count all records, including deleted ones, to detect accidental or partially rolled-back writes. */
function counts(f: Fixture) {
  return [
    inventories,
    inventoryFields,
    inventoryItems,
    inventoryItemValues,
    inventoryFieldOptions,
  ].map((table) => f.db.select().from(table).all().length);
}

// Source rows are available independently of typed mappings; no original path or active record is created by upload.
test("prepares tables, pages immutable source rows and validates all rows without saving records", async (context) => {
  const f = await fixture(context);
  const source =
    "Quantity,Note\n" +
    Array.from(
      { length: 60 },
      (_, index) => `${index === 59 ? "unknown" : index},Row ${index}`,
    ).join("\n");
  const preview = await f.api
    .post(path)
    .query({ format: "csv" })
    .set("Content-Type", "text/csv")
    .send(source)
    .expect(201);
  assert.equal(preview.body.status, "ready");
  assert.equal(preview.body.column_count, 2);
  assert.equal(preview.body.row_count, 60);
  assert.equal(preview.body.rows, undefined);
  assert.equal(preview.headers["cache-control"], "no-store");
  const url = `${path}/${preview.body.id}`;
  const page = await f.api
    .get(`${url}/rows`)
    .query({ offset: 59, limit: 1 })
    .expect(200);
  assert.deepEqual(page.body, {
    offset: 59,
    limit: 1,
    total_rows: 60,
    headers: ["Quantity", "Note"],
    rows: [["unknown", "Row 59"]],
  });
  const columns = [{ column: 0, name: "Quantity", field_type: "number" }];
  const result = await f.api
    .post(`${url}/validate`)
    .send({ columns })
    .expect(200);
  assert.deepEqual(result.body, {
    valid: false,
    issues: [{ row: 59, column: 0, code: "invalid_value" }],
  });
  const rejected = await f.api
    .post(`${url}/confirm`)
    .send({ name: "Blocked", columns })
    .expect(422);
  assert.equal(rejected.body.detail.code, "invalid_inventory_table_values");
  await f.api
    .post(`${url}/validate`)
    .send({ columns: textColumns })
    .expect(200, { valid: true, issues: [] });
  assert.deepEqual(counts(f), [0, 0, 0, 0, 0]);
  const copy = await f.tables.rows(preview.body.id);
  copy.headers[0] = "Changed";
  copy.rows[0]![0] = "Changed";
  assert.equal((await f.tables.rows(preview.body.id)).headers[0], "Quantity");
  assert.equal((await f.tables.rows(preview.body.id)).rows[0]![0], "0");
  assert.equal((await f.api.get(url).expect(200)).body.status, "ready");
  await f.api.delete(url).expect(204);
  await f.api.get(url).expect(404);
  assert.deepEqual(f.errors, []);
});

// Publication reuses one atomic transaction, preserves source order and interprets IDs as ordinary numbers.
test("atomically imports mapped CSV values and inferred choices into a new grouped inventory", async (context) => {
  const f = await fixture(context);
  const group = f.services.groups.create({ name: "Destination" });
  const source =
    "Code,Source ID,Ports,Installed,Since,Ignored\n00123,7,USB; Power,false,2026-11-06,x\n00234,9,Power,true,2026-11-07,y\n";
  const prepared = await f.tables.prepare(Readable.from([source]), {
    format: "csv",
  });
  const columns = [
    { column: 0, name: "Code", field_type: "text" },
    { column: 1, name: "Source ID", field_type: "number" },
    { column: 2, name: "Ports", field_type: "multiselect" },
    { column: 3, name: "Installed", field_type: "checkbox" },
    { column: 4, name: "Since", field_type: "date" },
  ];
  const data = {
    name: "Foreign table",
    description: "Imported data",
    group_id: group.id,
    columns,
  };
  const before = counts(f);
  assert.deepEqual(await f.tables.validate(prepared.id, { columns }), {
    valid: true,
    issues: [],
  });
  assert.deepEqual(counts(f), before);
  const [first, duplicate] = await Promise.all([
    f.tables.confirm(prepared.id, data),
    f.tables.confirm(prepared.id, data),
  ]);
  assert.equal(first.id, duplicate.id);
  assert.equal(first.groupId, group.id);
  const snapshot = readExportSnapshot(f.db, first.id).manifest;
  assert.deepEqual(
    snapshot.fields.map((field) => [field.name, field.field_type]),
    columns.map((column) => [column.name, column.field_type]),
  );
  assert.deepEqual(
    snapshot.fields[2]!.options.map((option) => option.name),
    ["USB", "Power"],
  );
  assert.deepEqual(
    snapshot.items.map((item) =>
      item.values.slice(0, 2).map((cell) => cell.value),
    ),
    [
      ["00123", 7],
      ["00234", 9],
    ],
  );
  assert.deepEqual(
    snapshot.items.map((item) => item.values[3]!.value),
    [false, true],
  );
  assert.deepEqual(counts(f), [1, 5, 2, 10, 2]);
  assert.deepEqual(await f.tables.read(prepared.id), {
    ...prepared,
    status: "completed",
    inventory_id: first.id,
    expires_at: (await f.tables.read(prepared.id)).expires_at,
  });
  await assert.rejects(
    f.tables.rows(prepared.id),
    /already being confirmed or completed/,
  );
  const retry = await f.tables.confirm(prepared.id, {
    ...data,
    columns: [...columns]
      .reverse()
      .map((column) =>
        column.field_type === "multiselect"
          ? { ...column, separator: ";" }
          : column,
      ),
  });
  assert.equal(retry.id, first.id);
  await assert.rejects(
    f.tables.confirm(prepared.id, { ...data, name: "Different" }),
    /already being confirmed or completed/,
  );
  await assert.rejects(
    f.tables.confirm(prepared.id, { ...data, columns: textColumns }),
    /already being confirmed or completed/,
  );
  await f.tables.discard(prepared.id);
  assert.equal(f.services.inventories.get(first.id).id, first.id);
  assert.deepEqual(await readdir(f.directory), []);
});

// Markdown rows become data only after explicit interpretation; raw content and source coordinates remain available.
test("confirms Markdown imports through HTTP and recovers completed receipts", async (context) => {
  const f = await fixture(context);
  const prepared = await f.api
    .post(path)
    .query({ format: "markdown" })
    .set("Content-Type", "text/markdown")
    .send("| Label | Ports |\n| --- | --- |\n| A\\|B | USB; Power |\n")
    .expect(201);
  const url = `${path}/${prepared.body.id}`;
  const columns = [
    { column: 0, name: "Label", field_type: "text" },
    { column: 1, name: "Ports", field_type: "multiselect" },
  ];
  await f.api
    .post(`${url}/validate`)
    .send({ columns })
    .expect(200, { valid: true, issues: [] });
  const request = { name: "Markdown table", columns };
  const result = await f.api.post(`${url}/confirm`).send(request).expect(200);
  const retry = await f.api.post(`${url}/confirm`).send(request).expect(200);
  assert.equal(result.body.id, retry.body.id);
  const status = await f.api.get(url).expect(200);
  assert.equal(status.body.inventory_id, result.body.id);
  assert.equal(status.body.status, "completed");
  assert.equal(
    f.services.items.list(result.body.id)[0]!.values[0]!.value,
    "A|B",
  );
  await f.api.get(`${url}/rows`).expect(409);
  await f.api.post(`${url}/validate`).send({ columns }).expect(409);
  await f.api
    .post(`${url}/confirm`)
    .send({ ...request, name: "Other" })
    .expect(409);
  await f.api.delete(url).expect(204);
  assert.equal(f.services.inventories.list().length, 1);
  assert.deepEqual(f.errors, []);
});

// A failed late item write rolls back the inventory and fields, allowing a corrected destination or a retry.
test("rolls back failed publication and retains the preview after database or destination errors", async (context) => {
  const f = await fixture(context);
  const preview = await f.tables.prepare(Readable.from(["Value\nOne\nTwo"]), {
    format: "csv",
  });
  const input = { name: "Retry", columns: textColumns };
  await assert.rejects(
    f.tables.confirm(preview.id, { ...input, group_id: "missing" }),
    /not found/,
  );
  f.sqlite.exec(
    "CREATE TRIGGER fail_table_item BEFORE INSERT ON inventory_items BEGIN SELECT RAISE(ABORT, 'synthetic table failure'); END;",
  );
  await assert.rejects(
    f.tables.confirm(preview.id, input),
    /synthetic table failure/,
  );
  assert.deepEqual(counts(f), [0, 0, 0, 0, 0]);
  assert.equal((await f.tables.read(preview.id)).status, "ready");
  assert.equal((await f.tables.rows(preview.id)).rows.length, 2);
  f.sqlite.exec("DROP TRIGGER fail_table_item;");
  await f.tables.confirm(preview.id, input);
  assert.deepEqual(counts(f), [1, 1, 2, 2, 0]);
});

// Pending publication is protected from cancel/expiry; reset invalidates queued work before its transaction starts.
test("protects pending confirmation and prevents publication after session reset", async (context) => {
  const f = await fixture(context);
  const preview = await f.tables.prepare(Readable.from(["Value\nOne"]), {
    format: "csv",
  });
  const confirming = f.tables.confirm(preview.id, {
    name: "Pending",
    columns: textColumns,
  });
  const status = f.tables.read(preview.id);
  const discarded = assert.rejects(
    f.tables.discard(preview.id),
    /already being confirmed or completed/,
  );
  f.tables.cleanup(Date.now() + importSessionLifetime + 1);
  assert.equal((await status).status, "importing");
  await discarded;
  const inventory = await confirming;
  assert.equal((await f.tables.read(preview.id)).inventory_id, inventory.id);
  const resetPreview = await f.tables.prepare(Readable.from(["Value\nTwo"]), {
    format: "csv",
  });
  const rejected = f.tables.confirm(resetPreview.id, {
    name: "Invalidated",
    columns: textColumns,
  });
  const resetResult = assert.rejects(rejected, /unavailable or expired/);
  await f.services.imports!.reset();
  await resetResult;
  assert.equal(f.services.inventories.list().length, 1);
  await assert.rejects(f.tables.read(preview.id), /unavailable or expired/);
});

// Maintenance uses the existing import lifecycle and never deletes an already committed inventory.
test("expires previews and receipts, loses tokens on restart and never recreates deleted results", async (context) => {
  const f = await fixture(context);
  const preview = await f.tables.prepare(Readable.from(["Value\nOne"]), {
    format: "csv",
  });
  await assert.rejects(
    createServices(f.db, { directory: f.directory }).imports!.tables.read(
      preview.id,
    ),
    /unavailable or expired/,
  );
  const imported = await f.tables.confirm(preview.id, {
    name: "Result",
    columns: textColumns,
  });
  f.services.inventories.delete(imported.id);
  await assert.rejects(
    f.tables.confirm(preview.id, { name: "Result", columns: textColumns }),
    /not found/,
  );
  assert.equal(f.db.select().from(inventories).all().length, 1);
  const ready = await f.tables.prepare(Readable.from(["Value\nTwo"]), {
    format: "csv",
  });
  await f.services.imports!.cleanup(Date.now() + importSessionLifetime + 1);
  await assert.rejects(f.tables.read(ready.id), /unavailable or expired/);
  await assert.rejects(f.tables.read(preview.id), /unavailable or expired/);
});

// Input failures do not leave previews, scratch files or active inventory records.
test("rejects oversized or aborted uploads without publishing data", async (context) => {
  const f = await fixture(context);
  await assert.rejects(
    f.tables.prepare(
      Readable.from(["Value\nOne"]),
      { format: "csv" },
      AbortSignal.abort(),
    ),
    /abort/i,
  );
  const source = new PassThrough();
  const controller = new AbortController();
  const preparing = f.tables.prepare(
    source,
    { format: "csv" },
    controller.signal,
  );
  source.write("Value\n");
  controller.abort();
  await assert.rejects(preparing, /abort/i);
  const chunk = Buffer.alloc(1024 * 1024, 65);
  const tooLarge = Readable.from(
    (function* () {
      for (let count = 0; count <= maxTableBytes / chunk.length; count++)
        yield chunk;
    })(),
  );
  await assert.rejects(
    f.tables.prepare(tooLarge, { format: "csv" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "table_too_large",
  );
  assert.deepEqual(counts(f), [0, 0, 0, 0, 0]);
  assert.deepEqual(await readdir(f.directory), []);
});

// File/parser failures are structured 422 responses, while malformed JSON mappings remain ordinary request errors.
test("validates public upload, page and mapping parameters and scopes table tokens away from ZIP imports", async (context) => {
  const f = await fixture(context);
  await f.api.post(path).send({ format: "csv" }).expect(415);
  for (const query of [
    {},
    { format: "zip" },
    { format: "csv", delimiter: "|" },
    { format: "csv", extra: true },
  ])
    await f.api
      .post(path)
      .query(query)
      .set("Content-Type", "text/plain")
      .send("Value\nOne")
      .expect(422);
  for (const [format, source, code] of [
    ["csv", 'Value\n"unfinished', "invalid_csv"],
    ["markdown", "Prose\n| A |\n| --- |", "invalid_markdown_table"],
    ["csv", Buffer.from([0xff]), "invalid_table_encoding"],
  ] as const) {
    const result = await f.api
      .post(path)
      .query({ format })
      .set("Content-Type", "application/octet-stream")
      .send(source)
      .expect(422);
    assert.equal(result.body.detail.code, code);
  }
  const preview = await f.api
    .post(path)
    .query({ format: "csv", delimiter: ";" })
    .set("Content-Type", "text/plain")
    .send("A;B\nOne;Two")
    .expect(201);
  const url = `${path}/${preview.body.id}`;
  await f.api.get(`/inventory-imports/${preview.body.id}`).expect(404);
  await f.api
    .post(`/inventory-imports/${preview.body.id}/confirm`)
    .send({ name: "Wrong route" })
    .expect(404);
  for (const query of [
    { offset: -1 },
    { limit: 0 },
    { limit: 201 },
    { offset: "abc" },
    { extra: true },
  ])
    await f.api.get(`${url}/rows`).query(query).expect(422);
  for (const body of [
    { columns: [] },
    { columns: [{ ...textColumns[0], column: 2 }] },
    { columns: textColumns, extra: true },
  ])
    await f.api.post(`${url}/validate`).send(body).expect(422);
  await f.api
    .post(`${url}/confirm`)
    .send({ name: " ", columns: textColumns })
    .expect(422);
  await f.api
    .post(`${url}/confirm`)
    .send({ name: "Missing columns" })
    .expect(422);
  assert.deepEqual(counts(f), [0, 0, 0, 0, 0]);
  assert.equal((await f.api.get(url).expect(200)).body.status, "ready");
  await f.api.delete(url).expect(204);
  assert.deepEqual(f.errors, []);
});
