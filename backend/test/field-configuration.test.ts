import { itemRevision } from "./helpers/item-revision.js";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";

/**
 * Create isolated field configuration fixtures without touching application data.
 * @param context The test cleanup context.
 * @returns The database, domain services, HTTP client, and empty inventory.
 */
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const api = request(createApp({ error: () => {} }, services));
  const inventory = services.inventories.create({
    name: "Synthetic configuration",
  });
  return { ...connection, services, api, inventory };
}

// Test checkbox definitions, strict boolean values, false as a valid requirement, and atomic errors.
test("checkbox fields accept only booleans and preserve required-field replacement rules", async (context) => {
  const { services, inventory, api, sqlite } = fixture(context);
  const base = `/inventories/${inventory.id}`;
  const old = services.items.create(inventory.id, {});
  const created = await api
    .post(`${base}/fields`)
    .send({ name: "Checked", field_type: "checkbox", is_required: true })
    .expect(201);
  const id = created.body.id as string;
  assert.equal(created.body.field_type, "checkbox");
  assert.deepEqual(services.items.read(inventory.id, old.id).values, []);
  await api.post(`${base}/items`).send({}).expect(422);
  await api
    .patch(`${base}/items/${old.id}`)
    .send({
      ...{},
      expected_revision: itemRevision(services, `${base}/items/${old.id}`),
    })
    .expect(422);
  await api
    .patch(`${base}/items/${old.id}`)
    .send({
      ...{ values: [{ field_id: id, value: false }] },
      expected_revision: itemRevision(services, `${base}/items/${old.id}`),
    })
    .expect(200);
  for (const value of [false, true]) {
    const result = await api
      .post(`${base}/items`)
      .send({ values: [{ field_id: id, value }] })
      .expect(201);
    assert.equal(result.body.values[0].value, value);
  }
  const before = sqlite
    .prepare("SELECT * FROM inventory_item_values ORDER BY id")
    .all();
  for (const value of [0, 1, "true", "false", null, "", [], {}]) {
    await api
      .post(`${base}/items`)
      .send({ values: [{ field_id: id, value }] })
      .expect(422);
    await api
      .patch(`${base}/items/${old.id}`)
      .send({
        ...{ values: [{ field_id: id, value }] },
        expected_revision: itemRevision(services, `${base}/items/${old.id}`),
      })
      .expect(422);
  }
  assert.deepEqual(
    sqlite.prepare("SELECT * FROM inventory_item_values ORDER BY id").all(),
    before,
  );
  await api
    .post(`${base}/fields`)
    .send({
      name: "Invalid",
      field_type: "checkbox",
      options: [{ name: "Not applicable" }],
    })
    .expect(422);
  await api
    .post(`${base}/fields`)
    .send({ name: "Invalid", field_type: "checkbox", max_length: 10 })
    .expect(422);
  await api
    .patch(`${base}/fields/${id}`)
    .send({ is_required: false })
    .expect(200);
  const cleared = await api
    .patch(`${base}/items/${old.id}`)
    .send({
      ...{ values: [] },
      expected_revision: itemRevision(services, `${base}/items/${old.id}`),
    })
    .expect(200);
  assert.deepEqual(cleared.body.values, []);
});

// Test strict flags, compatible defaults, explicit false values, and stable field identities.
test("creates and updates required and sortable flags without changing the field type", async (context) => {
  const { api, services, inventory } = fixture(context);
  const path = `/inventories/${inventory.id}/fields`;
  const field = (
    await api.post(path).send({ name: "Link", field_type: "url" }).expect(201)
  ).body;
  assert.equal(field.is_required, false);
  assert.equal(field.is_sortable, true);
  const changed = (
    await api
      .patch(`${path}/${field.id}`)
      .send({ is_required: true, is_sortable: false })
      .expect(200)
  ).body;
  assert.equal(changed.id, field.id);
  assert.equal(changed.field_type, "url");
  assert.equal(changed.is_required, true);
  assert.equal(changed.is_sortable, false);
  const unchanged = (
    await api.patch(`${path}/${field.id}`).send({}).expect(200)
  ).body;
  assert.deepEqual(unchanged, changed);
  for (const invalid of [null, "true", "false", 0, 1]) {
    await api
      .patch(`${path}/${field.id}`)
      .send({ is_required: invalid })
      .expect(422);
    await api
      .post(path)
      .send({ name: "Invalid", is_sortable: invalid })
      .expect(422);
  }
  await api
    .patch(`${path}/${field.id}`)
    .send({ is_required: false, is_sortable: true })
    .expect(200);
  assert.equal(services.fields.get(inventory.id, field.id).isRequired, false);
  assert.equal(services.fields.get(inventory.id, field.id).isSortable, true);
});

// Test atomic updates of field flags and rollback behavior on failure.
test("saves field flags atomically without forcing backfills of existing items", (context) => {
  const { services, inventory } = fixture(context);
  const field = services.fields.create(inventory.id, { name: "Existing" });
  const item = services.items.create(inventory.id, {});
  assert.throws(() =>
    services.inventoryEditor.save(inventory.id, {
      inventory: { name: "Must roll back" },
      fields: [
        {
          action: "update",
          field_id: field.id,
          data: { is_required: true, is_sortable: false },
        },
      ],
      options: [
        { action: "delete", field_id: "missing", option_id: "missing" },
      ],
      expected_revision: services.inventories.get(inventory.id)
        .configurationRevision,
    }),
  );
  assert.equal(services.inventories.get(inventory.id).name, inventory.name);
  assert.equal(services.fields.get(inventory.id, field.id).isRequired, false);
  assert.equal(services.fields.get(inventory.id, field.id).isSortable, true);
  const saved = services.inventoryEditor.save(inventory.id, {
    fields: [
      {
        action: "update",
        field_id: field.id,
        data: { is_required: true, is_sortable: false },
      },
    ],
    expected_revision: services.inventories.get(inventory.id)
      .configurationRevision,
  });
  assert.equal(saved.fields[0]?.isRequired, true);
  assert.equal(saved.fields[0]?.isSortable, false);
  assert.deepEqual(services.items.read(inventory.id, item.id), item);
  assert.throws(() =>
    services.items.update(inventory.id, item.id, {
      ...{},
      expected_revision: services.items.get(inventory.id, item.id).revision,
    }),
  );
});

// Test HTTP(S)-only structured links with optional display text and exact round trips.
test("validates URL values and preserves optional link text", async (context) => {
  const { api, services, inventory } = fixture(context);
  const field = services.fields.create(inventory.id, {
    name: "Website",
    field_type: "url",
  });
  const path = `/inventories/${inventory.id}/items`;
  for (const value of [
    { url: "https://example.com/docs?q=1#help" },
    { url: "http://localhost:8000", label: "Local documentation" },
    { url: "https://example.com", label: "" },
  ]) {
    const result = await api
      .post(path)
      .send({ values: [{ field_id: field.id, value }] })
      .expect(201);
    assert.deepEqual(result.body.values[0].value, value);
    assert.deepEqual(
      (await api.get(`${path}/${result.body.id}`).expect(200)).body.values[0]
        .value,
      value,
    );
  }
  for (const value of [
    "https://example.com",
    null,
    {},
    { label: "Missing address" },
    { url: "" },
    { url: "example.com" },
    { url: "/relative" },
    { url: "javascript:alert(1)" },
    { url: "data:text/html,test" },
    { url: "file:///etc/passwd" },
    { url: "ftp://example.com" },
    { url: "https://" },
    { url: "https://example.com/a b" },
    { url: "https://example.com\n" },
    { url: "https://example.com", label: 12 },
    { url: "https://example.com", unexpected: true },
  ]) {
    await api
      .post(path)
      .send({ values: [{ field_id: field.id, value }] })
      .expect(422);
  }
  assert.equal(services.items.list(inventory.id).length, 3);
});

// Test behavior when new required fields are added to existing items.
test("new required fields leave old items readable but block incomplete creates and edits", async (context) => {
  const { api, services, inventory, sqlite } = fixture(context);
  const title = services.fields.create(inventory.id, { name: "Title" });
  const item = services.items.create(inventory.id, {
    values: [{ field_id: title.id, value: "Original" }],
  });
  const before = sqlite
    .prepare("SELECT * FROM inventory_item_values ORDER BY id")
    .all();
  const required = services.fields.create(inventory.id, {
    name: "Location",
    is_required: true,
  });
  const path = `/inventories/${inventory.id}/items`;
  assert.deepEqual(services.items.read(inventory.id, item.id), item);
  await api.get(`${path}/${item.id}`).expect(200);
  for (const value of [undefined, "", "   ", "\t\n", null]) {
    const values = [
      { field_id: title.id, value: "Changed" },
      ...(value === undefined ? [] : [{ field_id: required.id, value }]),
    ];
    await api.post(path).send({ values }).expect(422);
    await api
      .patch(`${path}/${item.id}`)
      .send({
        ...{ values },
        expected_revision: itemRevision(services, `${path}/${item.id}`),
      })
      .expect(422);
    assert.deepEqual(
      sqlite.prepare("SELECT * FROM inventory_item_values ORDER BY id").all(),
      before,
    );
  }
  await api
    .patch(`${path}/${item.id}`)
    .send({
      ...{ values: [{ field_id: required.id, value: "Drawer" }] },
      expected_revision: itemRevision(services, `${path}/${item.id}`),
    })
    .expect(200);
  const updated = services.items.read(inventory.id, item.id);
  assert.equal(updated.values.length, 1);
  assert.equal(updated.values[0]?.fieldId, required.id);
  services.fields.update(inventory.id, required.id, { is_required: false });
  await api
    .patch(`${path}/${item.id}`)
    .send({
      ...{ values: [] },
      expected_revision: itemRevision(services, `${path}/${item.id}`),
    })
    .expect(200);
});

// Test a later requirement toggle independently of adding a new field.
test("enabling a requirement does not rewrite an existing item's values", (context) => {
  const { services, inventory, sqlite } = fixture(context);
  const field = services.fields.create(inventory.id, { name: "Location" });
  const item = services.items.create(inventory.id, {});
  services.fields.update(inventory.id, field.id, { is_required: true });
  assert.deepEqual(services.items.read(inventory.id, item.id), item);
  assert.throws(() =>
    services.items.update(inventory.id, item.id, {
      ...{},
      expected_revision: services.items.get(inventory.id, item.id).revision,
    }),
  );
  assert.equal(
    (
      sqlite
        .prepare("SELECT count(*) AS count FROM inventory_item_values")
        .get() as { count: number }
    ).count,
    0,
  );
});

// Test false, numeric zero, and zero seconds as explicitly supplied required values.
test("accepts explicit false and zero values but rejects omitted required values", async (context) => {
  const { api, services, inventory } = fixture(context);
  const definitions = ["boolean", "number", "duration"] as const;
  const fields = definitions.map((field_type) =>
    services.fields.create(inventory.id, {
      name: field_type,
      field_type,
      is_required: true,
    }),
  );
  const values = fields.map((field, index) => ({
    field_id: field.id,
    value: index === 0 ? false : 0,
  }));
  const path = `/inventories/${inventory.id}/items`;
  await api.post(path).send({ values }).expect(201);
  for (const field of fields) {
    await api
      .post(path)
      .send({ values: values.filter((value) => value.field_id !== field.id) })
      .expect(422);
  }
});

// Test the remaining required types using their normal type-specific validation.
test("requires valid URLs, selections, dates, and times", async (context) => {
  const definitions = [
    ["url", { url: "https://example.com" }],
    ["select", 0],
    ["multiselect", [0]],
    ["date", "2026-10-15"],
    ["time", "12:30"],
    ["datetime", "2026-10-15T12:30"],
  ] as const;
  for (const [field_type, value] of definitions) {
    const { api, services, inventory } = fixture(context);
    const field = services.fields.create(inventory.id, {
      name: field_type,
      field_type,
      is_required: true,
      ...(["select", "multiselect"].includes(field_type)
        ? { options: [{ name: "Option" }] }
        : {}),
    });
    const actual =
      field_type === "select"
        ? field.options[0]!.id
        : field_type === "multiselect"
          ? [field.options[0]!.id]
          : value;
    const path = `/inventories/${inventory.id}/items`;
    await api.post(path).send({}).expect(422);
    await api
      .post(path)
      .send({ values: [{ field_id: field.id, value: actual }] })
      .expect(201);
  }
});

// Test that durations stay exact when converted between seconds and human-readable units.
test("limits duration values to non-negative safe integer seconds", async (context) => {
  const { api, services, inventory } = fixture(context);
  const field = services.fields.create(inventory.id, {
    name: "Runtime",
    field_type: "duration",
  });
  const path = `/inventories/${inventory.id}/items`;
  for (const value of [0, 125 * 3600 + 30 * 60, Number.MAX_SAFE_INTEGER]) {
    await api
      .post(path)
      .send({ values: [{ field_id: field.id, value }] })
      .expect(201);
  }
  for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, "3600", true]) {
    await api
      .post(path)
      .send({ values: [{ field_id: field.id, value }] })
      .expect(422);
  }
});
