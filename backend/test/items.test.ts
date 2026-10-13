import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import {
  inventoryFields,
  inventoryItems,
  inventoryItemValues,
} from "../src/db/schema.js";
import { createServices } from "../src/services.js";
import { DomainError } from "../src/errors.js";

// Tests for inventory item API endpoints
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const errors: unknown[] = [];
  const api = request(
    createApp({ error: (_message, error) => errors.push(error) }, services),
  );
  const inventory = services.inventories.create({ name: "Synthetic items" });
  return { ...connection, services, api, inventory, errors };
}

// Helper function to set up the test fixture for each test case.
test("the nine field types pass definition/create/read/update through a compact HTTP matrix", async (context) => {
  const { services, api, inventory } = fixture(context);
  const base = `/inventories/${inventory.id}`;
  const cases: [
    typeof inventoryFields.$inferSelect.fieldType,
    unknown,
    unknown,
  ][] = [
    ["text", "  Title  ", ""],
    ["number", -3.5, 0],
    ["boolean", false, true],
    ["date", "2026-10-13", "2026W422"],
    ["time", "12:30", "123000.123456"],
    ["datetime", "2026-10-13T12:30", "2026-10-13 12:30:00+02:00"],
    ["duration", 0, 7200],
    ["select", 0, 1],
    ["multiselect", [0, 1], [1, 1]],
  ];
  for (const [field_type, first, second] of cases) {
    const field = (
      await api
        .post(`${base}/fields`)
        .send({
          name: field_type,
          field_type,
          ...(field_type === "select" || field_type === "multiselect"
            ? { options: [{ name: "A" }, { name: "B" }] }
            : {}),
        })
        .expect(201)
    ).body;
    const input = (value: unknown) => {
      if (field_type === "select") return field.options[value as number].id;
      if (field_type === "multiselect")
        return (value as number[]).map((index) => field.options[index].id);
      return value;
    };
    const created = await api
      .post(`${base}/items`)
      .send({ values: [{ field_id: field.id, value: input(first) }] })
      .expect(201);
    assert.deepEqual(Object.keys(created.body).sort(), [
      "created_at",
      "id",
      "inventory_id",
      "updated_at",
      "values",
    ]);
    assert.deepEqual(Object.keys(created.body.values[0]).sort(), [
      "created_at",
      "field_id",
      "id",
      "updated_at",
      "value",
    ]);
    assert.equal(created.body.values[0].field_id, field.id);
    assert.deepEqual(created.body.values[0].value, input(first));
    await api.get(`${base}/items/${created.body.id}`).expect(200, created.body);
    const updated = await api
      .patch(`${base}/items/${created.body.id}`)
      .send({ values: [{ field_id: field.id, value: input(second) }] })
      .expect(200);
    assert.equal(updated.body.id, created.body.id);
    assert.equal(updated.body.updated_at, created.body.updated_at);
    assert.notEqual(updated.body.values[0].id, created.body.values[0].id);
    assert.deepEqual(updated.body.values[0].value, input(second));
  }
  assert.equal(services.items.list(inventory.id).length, 9);
});

// Test for replacement, omitted values, and deletion preserving tombstones and list ordering
test("replacement, omitted values, and deletion preserve tombstones and list ordering", async (context) => {
  const { api, db, services, inventory } = fixture(context);
  const field = services.fields.create(inventory.id, { name: "Title" });
  const base = `/inventories/${inventory.id}/items`;
  const item = services.items.create(inventory.id, {
    values: [{ field_id: field.id, value: "Original" }],
  });
  const empty = (await api.post(base).send({}).expect(201)).body;
  assert.deepEqual(empty.values, []);
  // Explicit fixture times remove ambiguity when two items are created within one millisecond.
  db.update(inventoryItems)
    .set({ createdAt: "2026-01-01T00:00:00.000Z" })
    .where(eq(inventoryItems.id, item.id))
    .run();
  db.update(inventoryItems)
    .set({ createdAt: "2026-01-02T00:00:00.000Z" })
    .where(eq(inventoryItems.id, empty.id))
    .run();
  const listed = (await api.get(base).expect(200)).body;
  assert.deepEqual(
    listed.map((row: { id: string }) => row.id),
    [empty.id, item.id],
  );
  assert.deepEqual(
    listed[1].values.map((row: { value: unknown }) => row.value),
    ["Original"],
  );
  await api
    .patch(`${base}/${item.id}`)
    .send({ values: [{ field_id: field.id, value: "Replacement" }] })
    .expect(200);
  const firstTombstone = db
    .select()
    .from(inventoryItemValues)
    .where(eq(inventoryItemValues.id, item.values[0]!.id))
    .get();
  assert.equal(firstTombstone?.value, null);
  assert.ok(firstTombstone?.deletedAt);
  const cleared = await api
    .patch(`${base}/${item.id}`)
    .send({ ignored: true })
    .expect(200);
  assert.deepEqual(cleared.body.values, []);
  services.items.update(inventory.id, item.id, {
    values: [{ field_id: field.id, value: "Last" }],
  });
  const deleted = await api.delete(`${base}/${item.id}`).expect(204);
  assert.equal(deleted.text, "");
  const values = db.select().from(inventoryItemValues).all();
  assert.equal(values.length, 3);
  assert.ok(
    values.every((value) => value.value === null && value.deletedAt !== null),
  );
  assert.deepEqual(
    db
      .select()
      .from(inventoryItemValues)
      .where(eq(inventoryItemValues.id, item.values[0]!.id))
      .get(),
    firstTombstone,
  );
  assert.ok(
    db.select().from(inventoryItems).where(eq(inventoryItems.id, item.id)).get()
      ?.deletedAt,
  );
  await api.get(`${base}/${item.id}`).expect(404, {
    detail: {
      code: "inventory_item_not_found",
      message: "Inventory item not found.",
    },
  });
  await api.delete(`${base}/${item.id}`).expect(404);
  assert.deepEqual(
    (await api.get(base).expect(200)).body.map((row: { id: string }) => row.id),
    [empty.id],
  );
});

// Test for error handling, including parent scoping, DTO precedence, structured value errors, and temporal validation errors
test("item errors preserve parent scoping, DTO precedence, structured value errors, and the temporal 500", async (context) => {
  const { api, services, inventory, errors, db } = fixture(context);
  const other = services.inventories.create({ name: "Other" });
  const field = services.fields.create(inventory.id, {
    name: "Date",
    field_type: "date",
  });
  const item = services.items.create(inventory.id, {});
  const missingParent = {
    detail: { code: "inventory_not_found", message: "Inventory not found." },
  };
  for (const method of ["get", "post", "patch", "delete"] as const) {
    const path =
      method === "post"
        ? "/inventories/missing/items"
        : `/inventories/missing/items/${item.id}`;
    await api[method](path)
      .send(method === "post" || method === "patch" ? {} : undefined)
      .expect(404, missingParent);
  }
  await api.get("/inventories/missing/items").expect(404, missingParent);
  for (const method of ["get", "patch", "delete"] as const) {
    await api[method](`/inventories/${other.id}/items/${item.id}`)
      .send(method === "patch" ? {} : undefined)
      .expect(404, {
        detail: {
          code: "inventory_item_not_found",
          message: "Inventory item not found.",
        },
      });
  }
  const invalidDto = await api
    .post("/inventories/missing/items")
    .send({ values: [{ field_id: field.id }] })
    .expect(422);
  assert.ok(Array.isArray(invalidDto.body.detail));
  assert.deepEqual(invalidDto.body.detail[0].loc, [
    "body",
    "values",
    0,
    "value",
  ]);
  await api
    .post(`/inventories/${inventory.id}/items`)
    .send({ values: [{ field_id: field.id, value: null }] })
    .expect(422, {
      detail: {
        code: "invalid_inventory_item_value",
        message: "Inventory item values are invalid.",
      },
    });
  const failed = await api
    .post(`/inventories/${inventory.id}/items`)
    .send({ values: [{ field_id: field.id, value: "not-a-date" }] })
    .expect(500);
  assert.equal(failed.text, "Internal Server Error");
  assert.match(failed.headers["content-type"] ?? "", /^text\/plain/);
  assert.equal(errors.length, 1);
  assert.equal(db.select().from(inventoryItems).all().length, 1);
  services.inventories.delete(inventory.id);
  await api
    .get(`/inventories/${inventory.id}/items/${item.id}`)
    .expect(404, missingParent);
});

// Test for handling deleted options and fields in old values
test("deleted options and fields remain readable in old values but cannot be resubmitted", (context) => {
  const { services, inventory } = fixture(context);
  const other = services.inventories.create({ name: "Other" });
  const foreign = services.fields.create(other.id, { name: "Foreign" });
  const field = services.fields.create(inventory.id, {
    name: "Select",
    field_type: "select",
    options: [{ name: "A" }],
  });
  const option = field.options[0]!;
  const input = { values: [{ field_id: field.id, value: option.id }] };
  const item = services.items.create(inventory.id, input);
  services.options.delete(inventory.id, field.id, option.id);
  assert.deepEqual(services.items.read(inventory.id, item.id), item);
  const invalid = (error: unknown) =>
    error instanceof DomainError &&
    error.code === "invalid_inventory_item_value";
  assert.throws(
    () => services.items.update(inventory.id, item.id, input),
    invalid,
  );
  assert.deepEqual(services.items.read(inventory.id, item.id), item);
  services.fields.delete(inventory.id, field.id);
  assert.deepEqual(services.items.list(inventory.id), [item]);
  assert.throws(() => services.items.create(inventory.id, input), invalid);
  assert.throws(
    () =>
      services.items.create(inventory.id, {
        values: [{ field_id: foreign.id, value: "x" }],
      }),
    invalid,
  );
});

// Test for ensuring that failed create, replacement, and delete transactions leave the entire item/value history unchanged
test("failed create, replacement, and delete transactions leave the entire item/value history unchanged", (context) => {
  const { services, inventory, db, sqlite } = fixture(context);
  const field = services.fields.create(inventory.id, {
    name: "Title",
    max_length: 10,
  });
  const input = (value: string) => ({
    values: [{ field_id: field.id, value }],
  });
  const item = services.items.create(inventory.id, input("Original"));
  const itemsBefore = db.select().from(inventoryItems).all();
  const valuesBefore = db.select().from(inventoryItemValues).all();
  const unchanged = () => {
    assert.deepEqual(db.select().from(inventoryItems).all(), itemsBefore);
    assert.deepEqual(db.select().from(inventoryItemValues).all(), valuesBefore);
  };
  assert.throws(() =>
    services.items.update(inventory.id, item.id, input("Far too long")),
  );
  unchanged();
  sqlite.exec(
    "CREATE TRIGGER fail_value BEFORE INSERT ON inventory_item_values BEGIN SELECT RAISE(ABORT, 'Synthetic persistence failure'); END;",
  );
  assert.throws(() => services.items.create(inventory.id, input("New")));
  unchanged();
  assert.throws(() =>
    services.items.update(inventory.id, item.id, input("New")),
  );
  unchanged();
  sqlite.exec(
    "DROP TRIGGER fail_value; CREATE TRIGGER fail_tombstone BEFORE UPDATE ON inventory_item_values BEGIN SELECT RAISE(ABORT, 'Synthetic deletion failure'); END;",
  );
  assert.throws(() => services.items.delete(inventory.id, item.id));
  unchanged();
});
