import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { eq } from "drizzle-orm";
import { openDatabase, type DatabaseConnection } from "../src/db/connection.js";
import { inventoryItems } from "../src/db/schema.js";
import { createServices } from "../src/services.js";
import { createApp } from "../src/app.js";

/**
 * Prepare isolated table-edit fixtures, including hidden-style values and server-owned IDs.
 * @param context The cleanup context owning the in-memory database.
 * @returns HTTP client, services, records, and a complete two-row replacement draft.
 */
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const inventory = services.inventories.create({ name: "Batch fixtures" });
  const title = services.fields.create(inventory.id, {
    name: "Title",
    is_required: true,
  });
  const note = services.fields.create(inventory.id, { name: "Note" });
  const checked = services.fields.create(inventory.id, {
    name: "Checked",
    field_type: "checkbox",
  });
  const number = services.fields.create(inventory.id, {
    name: "Quantity",
    field_type: "number",
  });
  const choice = services.fields.create(inventory.id, {
    name: "Category",
    field_type: "select",
    options: [{ name: "Adapter" }],
  });
  const automatic = services.fields.create(inventory.id, {
    name: "ID",
    field_type: "id",
  });
  const items = ["First", "Second", "Untouched"].map((value) =>
    services.items.create(inventory.id, {
      values: [
        { field_id: title.id, value },
        { field_id: note.id, value: "Old note" },
      ],
    }),
  );
  const first = items[0]!;
  const second = items[1]!;
  const untouched = items[2]!;
  const foreignInventory = services.inventories.create({
    name: "Other inventory",
  });
  const foreign = services.items.create(foreignInventory.id, {});
  const errors: unknown[] = [];
  const api = request(
    createApp({ error: (_message, error) => errors.push(error) }, services),
  );
  const configurationRevision = services.inventories.get(
    inventory.id,
  ).configurationRevision;
  const draft = {
    expected_configuration_revision: configurationRevision,
    items: [first, second].map((item) => ({
      item_id: item.id,
      expected_revision: item.revision,
      values: [
        { field_id: title.id, value: `Changed ${item.id}` },
        { field_id: checked.id, value: false },
        { field_id: number.id, value: 0 },
      ],
    })),
  };
  return {
    ...connection,
    services,
    inventory,
    title,
    note,
    checked,
    number,
    choice,
    automatic,
    first,
    second,
    untouched,
    foreignInventory,
    foreign,
    errors,
    api,
    configurationRevision,
    draft,
    path: `/inventories/${inventory.id}/items`,
  };
}

/**
 * Capture history, tombstones, timestamps, counters and unrelated domain records.
 * @param connection The isolated database whose exact state is compared.
 * @returns A complete domain snapshot, including inactive rows.
 */
function snapshot(connection: DatabaseConnection) {
  return [
    "inventories",
    "inventory_groups",
    "inventory_fields",
    "inventory_field_options",
    "inventory_items",
    "inventory_item_values",
  ].map((table) =>
    connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
  );
}

// Test both rows commit together, preserve server-owned assignments, and return request order.
test("atomically replaces multiple items without changing IDs, configuration or unrelated items", async (context) => {
  const f = fixture(context);
  const inventoryBefore = f.services.inventories.get(f.inventory.id);
  const fieldsBefore = f.services.fields.list(f.inventory.id);
  const assignmentsBefore = [f.first, f.second].map((item) =>
    item.values.find((value) => value.fieldId === f.automatic.id),
  );
  const originalValues = f.sqlite
    .prepare(
      "SELECT id FROM inventory_item_values WHERE field_id != ? AND item_id IN (?, ?)",
    )
    .all(f.automatic.id, f.first.id, f.second.id) as { id: string }[];
  const response = await f.api
    .patch(f.path)
    .send({ ...f.draft, items: [...f.draft.items].reverse() })
    .expect(200);
  assert.deepEqual(
    response.body.map((item: { id: string }) => item.id),
    [f.second.id, f.first.id],
  );
  for (const item of [f.first, f.second]) {
    const saved = f.services.items.read(f.inventory.id, item.id);
    assert.equal(saved.revision, item.revision + 1);
    assert.equal(
      saved.values.find((value) => value.fieldId === f.checked.id)?.value,
      false,
    );
    assert.equal(
      saved.values.find((value) => value.fieldId === f.number.id)?.value,
      0,
    );
    assert.equal(
      saved.values.some((value) => value.fieldId === f.note.id),
      false,
    );
  }
  assert.deepEqual(
    [f.first, f.second].map((item) =>
      f.services.items
        .read(f.inventory.id, item.id)
        .values.find((value) => value.fieldId === f.automatic.id),
    ),
    assignmentsBefore,
  );
  for (const original of originalValues) {
    const tombstone = f.sqlite
      .prepare(
        "SELECT value, deleted_at FROM inventory_item_values WHERE id = ?",
      )
      .get(original.id) as { value: unknown; deleted_at: unknown };
    assert.equal(tombstone.value, null);
    assert.ok(tombstone.deleted_at);
  }
  assert.deepEqual(
    f.services.items.read(f.inventory.id, f.untouched.id),
    f.untouched,
  );
  assert.deepEqual(
    f.services.items.read(f.foreignInventory.id, f.foreign.id),
    f.foreign,
  );
  assert.deepEqual(f.services.inventories.get(f.inventory.id), inventoryBefore);
  assert.deepEqual(f.services.fields.list(f.inventory.id), fieldsBefore);
});

// Test a later stale or exhausted revision rolls back earlier claims and value-history writes.
for (const exhausted of [false, true])
  test(`rolls back the complete draft when a later row is ${exhausted ? "revision-exhausted" : "stale"}`, async (context) => {
    const f = fixture(context);
    if (exhausted)
      f.db
        .update(inventoryItems)
        .set({ revision: Number.MAX_SAFE_INTEGER })
        .where(eq(inventoryItems.id, f.second.id))
        .run();
    else
      f.services.items.update(f.inventory.id, f.second.id, {
        expected_revision: f.second.revision,
        values: [{ field_id: f.title.id, value: "Other editor" }],
      });
    const before = snapshot(f);
    const draft = structuredClone(f.draft);
    if (exhausted) draft.items[1]!.expected_revision = Number.MAX_SAFE_INTEGER;
    const response = await f.api.patch(f.path).send(draft).expect(409);
    assert.equal(response.body.detail.code, "inventory_item_conflict");
    assert.equal(response.body.detail.item_id, f.second.id);
    assert.deepEqual(snapshot(f), before);
  });

// Test ownership and lifecycle checks apply to every row, even after an earlier valid replacement.
for (const missing of ["missing", "deleted", "foreign"] as const)
  test(`rejects a ${missing} later item without partial changes`, async (context) => {
    const f = fixture(context);
    const draft = structuredClone(f.draft);
    if (missing === "missing") draft.items[1]!.item_id = "missing-item";
    if (missing === "deleted")
      f.services.items.delete(f.inventory.id, f.second.id, {
        expected_revision: f.second.revision,
      });
    if (missing === "foreign") draft.items[1]!.item_id = f.foreign.id;
    const before = snapshot(f);
    const response = await f.api.patch(f.path).send(draft).expect(404);
    assert.equal(response.body.detail.code, "inventory_item_not_found");
    assert.equal(response.body.detail.item_id, draft.items[1]!.item_id);
    assert.deepEqual(snapshot(f), before);
  });

// Test the captured configuration guards field changes that do not advance item revisions.
test("rejects configuration changes without claiming or modifying any item revision", async (context) => {
  const f = fixture(context);
  f.services.fields.update(f.inventory.id, f.title.id, { is_required: false });
  assert.equal(
    f.services.items.get(f.inventory.id, f.first.id).revision,
    f.first.revision,
  );
  const before = snapshot(f);
  const response = await f.api.patch(f.path).send(f.draft).expect(409);
  assert.equal(response.body.detail.code, "inventory_configuration_conflict");
  assert.equal(response.body.detail.item_id, undefined);
  assert.deepEqual(snapshot(f), before);
});

// Test shared item validation covers each replacement and cannot leave an earlier row saved.
test("rolls back all rows for invalid, duplicate, unknown, required or automatic field values", async (context) => {
  const f = fixture(context);
  const values = [
    [{ field_id: f.title.id, value: false }],
    [],
    [
      { field_id: f.title.id, value: "Title" },
      { field_id: f.title.id, value: "Duplicate" },
    ],
    [
      { field_id: f.title.id, value: "Title" },
      { field_id: "missing", value: "Unknown" },
    ],
    [
      { field_id: f.title.id, value: "Title" },
      { field_id: f.automatic.id, value: 42 },
    ],
    [
      { field_id: f.title.id, value: "Title" },
      { field_id: f.choice.id, value: "missing-option" },
    ],
  ];
  const before = snapshot(f);
  for (const invalid of values) {
    const response = await f.api
      .patch(f.path)
      .send({
        ...f.draft,
        items: [f.draft.items[0], { ...f.draft.items[1], values: invalid }],
      })
      .expect(422);
    assert.equal(response.body.detail.code, "invalid_inventory_item_value");
    assert.equal(response.body.detail.item_id, f.second.id);
    assert.deepEqual(snapshot(f), before);
  }
});

// Test strict DTOs reject ambiguous batches before consuming revisions or clearing omitted values.
test("validates the entire request shape, revision preconditions and unique row identifiers", async (context) => {
  const f = fixture(context);
  const row = f.draft.items[0]!;
  const invalid: Record<string, unknown>[] = [
    {},
    { items: f.draft.items },
    { ...f.draft, items: [] },
    { ...f.draft, items: {} },
    { ...f.draft, items: [row, row] },
    { ...f.draft, items: [{ ...row, item_id: "" }] },
    {
      ...f.draft,
      items: [
        { item_id: row.item_id, expected_revision: row.expected_revision },
      ],
    },
    { ...f.draft, items: [{ ...row, values: [{ field_id: f.title.id }] }] },
    { ...f.draft, items: [{ item_id: row.item_id, values: row.values }] },
    {
      ...f.draft,
      items: [
        {
          ...row,
          values: [{ field_id: f.title.id, value: "Title", extra: true }],
        },
      ],
    },
    { ...f.draft, items: [{ ...row, extra: true }] },
    { ...f.draft, extra: true },
  ];
  for (const revision of [
    null,
    "1",
    false,
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    invalid.push({ ...f.draft, expected_configuration_revision: revision });
    invalid.push({
      ...f.draft,
      items: [{ ...row, expected_revision: revision }],
    });
  }
  const before = snapshot(f);
  for (const input of invalid) {
    const response = await f.api.patch(f.path).send(input).expect(422);
    assert.ok(Array.isArray(response.body.detail));
    assert.deepEqual(snapshot(f), before);
  }
  const duplicate = await f.api
    .patch(f.path)
    .send({ ...f.draft, items: [row, row] })
    .expect(422);
  assert.deepEqual(duplicate.body.detail[0].loc, [
    "body",
    "items",
    1,
    "item_id",
  ]);
});

// Test a storage failure after earlier row writes rolls back history, timestamps and revisions.
test("rolls back every row and tombstone when storage fails on a later replacement", async (context) => {
  const f = fixture(context);
  f.sqlite.exec(
    `CREATE TRIGGER fail_second BEFORE INSERT ON inventory_item_values WHEN NEW.item_id = '${f.second.id}' BEGIN SELECT RAISE(ABORT, 'Synthetic failure'); END;`,
  );
  const before = snapshot(f);
  await f.api.patch(f.path).send(f.draft).expect(500);
  assert.deepEqual(snapshot(f), before);
  assert.equal(f.errors.length, 1);
});

// Test a missing/deleted parent cannot be addressed even with otherwise valid row IDs.
test("rejects missing or deleted inventories and preserves successful no-op semantics", async (context) => {
  const f = fixture(context);
  const before = snapshot(f);
  const missing = await f.api
    .patch("/inventories/missing/items")
    .send(f.draft)
    .expect(404);
  assert.equal(missing.body.detail.code, "inventory_not_found");
  assert.deepEqual(snapshot(f), before);
  const saved = await f.api
    .patch(f.path)
    .send({
      ...f.draft,
      items: [
        {
          item_id: f.first.id,
          expected_revision: f.first.revision,
          values: f.first.values
            .filter((value) => value.fieldId !== f.automatic.id)
            .map((value) => ({ field_id: value.fieldId, value: value.value })),
        },
      ],
    })
    .expect(200);
  assert.equal(saved.body[0].revision, f.first.revision + 1);
  f.services.inventories.delete(f.inventory.id);
  const deletedBefore = snapshot(f);
  const deleted = await f.api.patch(f.path).send(f.draft).expect(404);
  assert.equal(deleted.body.detail.code, "inventory_not_found");
  assert.deepEqual(snapshot(f), deletedBefore);
});
