import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import {
  inventories,
  inventoryFields,
  inventoryFieldOptions,
  inventoryItems,
  inventoryItemValues,
} from "../src/db/schema.js";
import { createServices } from "../src/services.js";
import { ZodError } from "zod";

// Fixture function to set up the test environment with an in-memory database, services, API client, and error tracking.
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const errors: unknown[] = [];
  const api = request(
    createApp({ error: (_message, error) => errors.push(error) }, services),
  );
  return { ...connection, services, api, errors };
}

// Test suite for inventory HTTP CRUD operations.
test("inventory HTTP CRUD preserves the frontend DTO, ordering, partial updates, and empty 204 responses", async (context) => {
  const { api, db } = fixture(context);
  const created = await api
    .post("/inventories")
    .send({ name: "  Tools  ", description: "Workshop", ignored: true })
    .expect(201);
  const id = created.body.id as string;
  assert.deepEqual(Object.keys(created.body).sort(), [
    "created_at",
    "description",
    "group_id",
    "id",
    "name",
    "updated_at",
  ]);
  assert.equal(created.body.name, "Tools");
  await api.get(`/inventories/${id}`).expect(200, created.body);
  await api.post("/inventories").send({ name: "Cables" }).expect(201);
  const list = await api.get("/inventories").expect(200);
  assert.deepEqual(
    list.body.map((row: { name: string }) => row.name),
    ["Cables", "Tools"],
  );
  const noop = await api
    .patch(`/inventories/${id}`)
    .send({ name: null, ignored: 123 })
    .expect(200);
  assert.deepEqual(noop.body, created.body);
  const renamed = await api
    .patch(`/inventories/${id}`)
    .send({ name: "  Updated  " })
    .expect(200);
  assert.equal(renamed.body.description, "Workshop");
  assert.equal(renamed.body.name, "Updated");
  const cleared = await api
    .patch(`/inventories/${id}`)
    .send({ description: null })
    .expect(200);
  assert.equal(cleared.body.description, null);
  const deleted = await api.delete(`/inventories/${id}`).expect(204);
  assert.equal(deleted.text, "");
  const tombstone = db
    .select()
    .from(inventories)
    .where(eq(inventories.id, id))
    .get();
  assert.equal(tombstone?.name, "");
  assert.equal(tombstone?.description, null);
  assert.ok(tombstone?.deletedAt);
  assert.equal((await api.get("/inventories").expect(200)).body.length, 1);
});

// Test suite for select and multiselect HTTP CRUD operations.
test("select and multiselect HTTP CRUD embeds options and permits later duplicates and an empty option list", async (context) => {
  const { api, services } = fixture(context);
  const inventory = services.inventories.create({ name: "Synthetic games" });
  const base = `/inventories/${inventory.id}/fields`;
  for (const field_type of ["select", "multiselect"]) {
    const created = await api
      .post(base)
      .send({
        name: "  Category  ",
        field_type,
        options: [{ name: "First" }, { name: "Second" }],
      })
      .expect(201);
    const fieldId = created.body.id as string;
    const path = `${base}/${fieldId}`;
    assert.deepEqual(Object.keys(created.body).sort(), [
      "created_at",
      "field_type",
      "id",
      "inventory_id",
      "is_required",
      "is_sortable",
      "max_length",
      "name",
      "options",
      "position",
      "updated_at",
    ]);
    assert.equal(created.body.max_length, null);
    assert.equal(created.body.field_type, field_type);
    assert.deepEqual(
      created.body.options.map((option: { name: string; position: number }) => [
        option.name,
        option.position,
      ]),
      [
        ["First", 0],
        ["Second", 1],
      ],
    );
    await api.get(path).expect(200, created.body);
    const updated = await api
      .patch(path)
      .send({
        name: "  Genre  ",
        position: 8,
        field_type: "text",
        max_length: 42,
      })
      .expect(200);
    assert.equal(updated.body.name, "Genre");
    assert.equal(updated.body.position, 8);
    assert.equal(updated.body.field_type, field_type);
    const added = await api
      .post(`${path}/options`)
      .send({ name: " First " })
      .expect(201);
    assert.equal(added.body.position, 2);
    assert.deepEqual(Object.keys(added.body).sort(), [
      "created_at",
      "field_id",
      "id",
      "name",
      "position",
      "updated_at",
    ]);
    const renamed = await api
      .patch(`${path}/options/${added.body.id}`)
      .send({ name: "  Second  " })
      .expect(200);
    assert.equal(renamed.body.id, added.body.id);
    assert.equal(renamed.body.name, "Second");
    const noop = await api
      .patch(`${path}/options/${added.body.id}`)
      .send({ name: null })
      .expect(200);
    assert.deepEqual(noop.body, renamed.body);
    const options = (await api.get(`${path}/options`).expect(200)).body as {
      id: string;
    }[];
    for (const option of options)
      assert.equal(
        (await api.delete(`${path}/options/${option.id}`).expect(204)).text,
        "",
      );
    await api.get(`${path}/options`).expect(200, []);
    assert.deepEqual((await api.get(path).expect(200)).body.options, []);
  }
  const fields = await api.get(base).expect(200);
  assert.equal(fields.body.length, 2);
});

// Test suite for configuration APIs, focusing on error handling and validation precedence.
test("configuration APIs preserve scoped not-found codes, unsupported-option errors, and validation precedence", async (context) => {
  const { api, services } = fixture(context);
  const inventory = services.inventories.create({ name: "First" });
  const other = services.inventories.create({ name: "Second" });
  const field = services.fields.create(inventory.id, { name: "Text" });
  const selection = services.fields.create(inventory.id, {
    name: "Select",
    field_type: "select",
    options: [{ name: "A" }],
  });
  const option = selection.options[0]!;
  const cases = [
    ["get", "/inventories/missing", undefined, "inventory_not_found"],
    ["patch", "/inventories/missing", {}, "inventory_not_found"],
    ["delete", "/inventories/missing", undefined, "inventory_not_found"],
    ["get", "/inventories/missing/fields", undefined, "inventory_not_found"],
    [
      "post",
      "/inventories/missing/fields",
      { name: "Field" },
      "inventory_not_found",
    ],
    [
      "get",
      `/inventories/${other.id}/fields/${field.id}`,
      undefined,
      "inventory_field_not_found",
    ],
    [
      "patch",
      `/inventories/${inventory.id}/fields/missing`,
      {},
      "inventory_field_not_found",
    ],
    [
      "delete",
      `/inventories/${inventory.id}/fields/missing`,
      undefined,
      "inventory_field_not_found",
    ],
    [
      "get",
      `/inventories/${inventory.id}/fields/missing/options`,
      undefined,
      "inventory_field_not_found",
    ],
    [
      "post",
      `/inventories/${other.id}/fields/${selection.id}/options`,
      { name: "Option" },
      "inventory_field_not_found",
    ],
    [
      "patch",
      `/inventories/${inventory.id}/fields/${selection.id}/options/missing`,
      {},
      "inventory_field_option_not_found",
    ],
    [
      "delete",
      `/inventories/${inventory.id}/fields/${selection.id}/options/missing`,
      undefined,
      "inventory_field_option_not_found",
    ],
  ] as const;
  for (const [method, path, body, code] of cases) {
    const response = await api[method](path).send(body).expect(404);
    assert.equal(response.body.detail.code, code);
    assert.equal(typeof response.body.detail.message, "string");
  }
  await api
    .get(`/inventories/${inventory.id}/fields/${field.id}/options`)
    .expect(200, []);
  for (const method of ["post", "patch", "delete"] as const) {
    const suffix = method === "post" ? "" : `/${option.id}`;
    const response = await api[method](
      `/inventories/${inventory.id}/fields/${field.id}/options${suffix}`,
    )
      .send(method === "post" ? { name: "Option" } : {})
      .expect(422);
    assert.deepEqual(response.body.detail, {
      code: "inventory_field_options_not_supported",
      message: "Inventory field type does not support options.",
    });
  }
  const invalid = await api
    .post("/inventories/missing/fields")
    .send({ name: "Field", field_type: "invalid" })
    .expect(422);
  assert.ok(Array.isArray(invalid.body.detail));
  assert.deepEqual(invalid.body.detail[0].loc, ["body", "field_type"]);
  assert.equal(typeof invalid.body.detail[0].msg, "string");
  const missing = await api.post("/inventories").send({}).expect(422);
  assert.deepEqual(missing.body.detail[0].loc, ["body", "name"]);
});

// Test suite for verifying the behavior of option, field, and inventory deletion, ensuring child records and stored option IDs remain intact.
test("option, field, and inventory deletion leaves child records and stored option IDs untouched", async (context) => {
  const { api, db, services } = fixture(context);
  const inventory = services.inventories.create({
    name: "Synthetic",
    description: "Description",
  });
  const field = services.fields.create(inventory.id, {
    name: "Selection",
    field_type: "multiselect",
    options: [{ name: "A" }, { name: "B" }],
  });
  const option = field.options[0]!;
  const item = db
    .insert(inventoryItems)
    .values({ inventoryId: inventory.id })
    .returning()
    .get();
  const value = db
    .insert(inventoryItemValues)
    .values({
      itemId: item.id,
      fieldId: field.id,
      value: field.options.map((option) => option.id),
    })
    .returning()
    .get();
  const base = `/inventories/${inventory.id}/fields/${field.id}`;
  await api
    .patch(`${base}/options/${option.id}`)
    .send({ name: "Renamed" })
    .expect(200);
  assert.deepEqual(db.select().from(inventoryItemValues).all(), [value]);
  await api.delete(`${base}/options/${option.id}`).expect(204);
  assert.deepEqual(db.select().from(inventoryItemValues).all(), [value]);
  const tombstone = db
    .select()
    .from(inventoryFieldOptions)
    .where(eq(inventoryFieldOptions.id, option.id))
    .get();
  assert.equal(tombstone?.name, "");
  assert.ok(tombstone?.deletedAt);
  await api
    .patch(`${base}/options/${option.id}`)
    .send({ name: "Restore" })
    .expect(404);
  const optionsBefore = db.select().from(inventoryFieldOptions).all();
  await api.delete(base).expect(204);
  assert.equal(db.select().from(inventoryFields).get()?.name, "");
  assert.ok(db.select().from(inventoryFields).get()?.deletedAt);
  assert.deepEqual(
    db.select().from(inventoryFieldOptions).all(),
    optionsBefore,
  );
  assert.deepEqual(db.select().from(inventoryItemValues).all(), [value]);
  await api.get(base).expect(404);
  await api.get(`${base}/options`).expect(404);
  const active = services.fields.create(inventory.id, { name: "Remaining" });
  const children = [
    inventoryFields,
    inventoryFieldOptions,
    inventoryItems,
    inventoryItemValues,
  ];
  const before = children.map((table) => db.select().from(table).all());
  await api.delete(`/inventories/${inventory.id}`).expect(204);
  assert.deepEqual(
    children.map((table) => db.select().from(table).all()),
    before,
  );
  await api.get(`/inventories/${inventory.id}/fields/${active.id}`).expect(404);
  await api.get(`/inventories/${inventory.id}/fields`).expect(404);
});

// Test suite for verifying the behavior of field positions and validation in direct services.
test("positions use active counts without renumbering, and direct services apply validation", (context) => {
  const { services, db } = fixture(context);
  const inventory = services.inventories.create({ name: "Synthetic" });
  const fields = ["First", "Middle", "Last"].map((name) =>
    services.fields.create(inventory.id, { name }),
  );
  services.fields.delete(inventory.id, fields[1]!.id);
  const added = services.fields.create(inventory.id, { name: "Added" });
  assert.equal(added.position, 2);
  assert.deepEqual(
    services.fields.list(inventory.id).map((field) => field.position),
    [0, 2, 2],
  );
  const noChange = services.fields.update(inventory.id, added.id, {
    name: null,
    position: null,
  });
  assert.equal(noChange.updatedAt, added.updatedAt);
  const selection = services.fields.create(inventory.id, {
    name: "Options",
    field_type: "select",
    options: [{ name: "A" }, { name: "B" }, { name: "C" }],
  });
  services.options.delete(inventory.id, selection.id, selection.options[1]!.id);
  const option = services.options.create(inventory.id, selection.id, {
    name: "D",
  });
  assert.equal(option.position, 2);
  assert.deepEqual(
    services.options
      .list(inventory.id, selection.id)
      .map((option) => option.position),
    [0, 2, 2],
  );
  assert.throws(
    () => services.inventories.update(inventory.id, { name: 42 }),
    ZodError,
  );
  assert.equal(services.inventories.get(inventory.id).name, "Synthetic");
  assert.equal(db.select().from(inventories).all().length, 1);
});

// Test suite for verifying atomicity of field and initial option creation when persistence fails.
test("field and initial option creation is atomic when persistence fails", (context) => {
  const { db, sqlite, services } = fixture(context);
  const inventory = services.inventories.create({ name: "Synthetic" });
  sqlite.exec(
    "CREATE TRIGGER fail_option BEFORE INSERT ON inventory_field_options WHEN NEW.name = 'Fail' BEGIN SELECT RAISE(ABORT, 'Synthetic persistence failure'); END;",
  );
  assert.throws(() =>
    services.fields.create(inventory.id, {
      name: "Selection",
      field_type: "select",
      options: [{ name: "Pass" }, { name: "Fail" }],
    }),
  );
  assert.deepEqual(db.select().from(inventoryFields).all(), []);
  assert.deepEqual(db.select().from(inventoryFieldOptions).all(), []);
  assert.equal(db.select().from(inventories).all().length, 1);
});

// Test suite for verifying that unexpected service errors result in generic HTTP 500 responses while logging the internal error.
test("unexpected service errors remain generic HTTP 500 responses with internal logging", async (context) => {
  const { services, api, errors } = fixture(context);
  const error = new Error("Synthetic internal detail");
  services.inventories.list = () => {
    throw error;
  };
  await api
    .get("/inventories")
    .expect(500, { detail: "Internal Server Error" });
  assert.deepEqual(errors, [error]);
});
