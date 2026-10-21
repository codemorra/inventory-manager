import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import { inventoryItems } from "../src/db/schema.js";
import { createServices } from "../src/services.js";

/**
 * Create isolated revision fixtures and a local HTTP client.
 * @param context The cleanup context owning the in-memory database.
 * @returns Domain services, connection, route, field, and saved item.
 */
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const inventory = services.inventories.create({ name: "Revision fixtures" });
  const field = services.fields.create(inventory.id, { name: "Title" });
  const item = services.items.create(inventory.id, {
    values: [{ field_id: field.id, value: "Original" }],
  });
  return {
    ...connection,
    services,
    inventory,
    field,
    item,
    path: `/inventories/${inventory.id}/items/${item.id}`,
    api: request(createApp({ error: () => {} }, services)),
  };
}

// Test two editors cannot overwrite or delete each other's completed changes, including checkbox-style replacements.
test("rejects stale item replacement and deletion without changing values or revision", async (context) => {
  const f = fixture(context);
  const first = (await f.api.get(f.path).expect(200)).body;
  const second = (await f.api.get(f.path).expect(200)).body;
  assert.equal(first.revision, 1);
  const changed = await f.api
    .patch(f.path)
    .send({
      expected_revision: first.revision,
      values: [{ field_id: f.field.id, value: "First editor" }],
    })
    .expect(200);
  assert.equal(changed.body.revision, 2);
  const before = f.sqlite
    .prepare("SELECT * FROM inventory_item_values ORDER BY id")
    .all();
  const stale = await f.api
    .patch(f.path)
    .send({
      expected_revision: second.revision,
      values: [{ field_id: f.field.id, value: "Stale editor" }],
    })
    .expect(409);
  assert.equal(stale.body.detail.code, "inventory_item_conflict");
  await f.api
    .delete(f.path)
    .send({ expected_revision: second.revision })
    .expect(409);
  assert.deepEqual(
    f.sqlite.prepare("SELECT * FROM inventory_item_values ORDER BY id").all(),
    before,
  );
  assert.equal(f.services.items.get(f.inventory.id, f.item.id).revision, 2);
  await f.api.delete(f.path).send({ expected_revision: 2 }).expect(204);
  const deleted = f.db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, f.item.id))
    .get()!;
  assert.equal(deleted.revision, 3);
  assert.ok(deleted.deletedAt);
  await f.api
    .patch(f.path)
    .send({ expected_revision: 2, values: [] })
    .expect(404);
});

// Test clients cannot omit the concurrency precondition or bypass it with coercion.
test("requires a positive safe integer revision for item writes", async (context) => {
  const f = fixture(context);
  for (const expected_revision of [
    undefined,
    null,
    0,
    -1,
    1.5,
    "1",
    true,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const body = expected_revision === undefined ? {} : { expected_revision };
    await f.api
      .patch(f.path)
      .send({ ...body, values: [] })
      .expect(422);
    await f.api.delete(f.path).send(body).expect(422);
  }
  assert.deepEqual(f.services.items.read(f.inventory.id, f.item.id), f.item);
});

// Test validation and storage failures roll back both revision claims and all value tombstones.
test("rolls back revision increments when replacement or deletion fails", async (context) => {
  const f = fixture(context);
  const before = f.sqlite
    .prepare("SELECT * FROM inventory_item_values ORDER BY id")
    .all();
  await f.api
    .patch(f.path)
    .send({
      expected_revision: 1,
      values: [{ field_id: f.field.id, value: true }],
    })
    .expect(422);
  assert.deepEqual(f.services.items.read(f.inventory.id, f.item.id), f.item);
  f.sqlite.exec(
    "CREATE TRIGGER fail_insert BEFORE INSERT ON inventory_item_values BEGIN SELECT RAISE(ABORT, 'Synthetic failure'); END;",
  );
  await f.api
    .patch(f.path)
    .send({
      expected_revision: 1,
      values: [{ field_id: f.field.id, value: "Changed" }],
    })
    .expect(500);
  assert.deepEqual(f.services.items.read(f.inventory.id, f.item.id), f.item);
  assert.deepEqual(
    f.sqlite.prepare("SELECT * FROM inventory_item_values ORDER BY id").all(),
    before,
  );
  f.sqlite.exec(
    "DROP TRIGGER fail_insert; CREATE TRIGGER fail_clear BEFORE UPDATE ON inventory_item_values BEGIN SELECT RAISE(ABORT, 'Synthetic failure'); END;",
  );
  await f.api.delete(f.path).send({ expected_revision: 1 }).expect(500);
  assert.deepEqual(f.services.items.read(f.inventory.id, f.item.id), f.item);
});

// Test configuration operations that alter values also invalidate open item snapshots.
test("field deletion and automatic ID backfills invalidate older item revisions", async (context) => {
  const f = fixture(context);
  f.services.fields.delete(f.inventory.id, f.field.id);
  assert.equal(f.services.items.get(f.inventory.id, f.item.id).revision, 2);
  await f.api
    .patch(f.path)
    .send({ expected_revision: 1, values: [] })
    .expect(409);
  f.services.fields.create(f.inventory.id, {
    name: "Number",
    field_type: "id",
  });
  const backfilled = f.services.items.read(f.inventory.id, f.item.id);
  assert.equal(backfilled.revision, 3);
  await f.api
    .patch(f.path)
    .send({ expected_revision: 2, values: [] })
    .expect(409);
  const saved = await f.api
    .patch(f.path)
    .send({ expected_revision: 3, values: [] })
    .expect(200);
  assert.equal(saved.body.revision, 4);
  assert.deepEqual(
    saved.body.values.map((value: { value: unknown }) => value.value),
    [1],
  );
});

// Test no-op replacements still consume a revision and counters never exceed safe integer precision.
test("advances revisions for successful replacements and rejects exhausted revisions", async (context) => {
  const f = fixture(context);
  const saved = await f.api
    .patch(f.path)
    .send({
      expected_revision: 1,
      values: [{ field_id: f.field.id, value: "Original" }],
    })
    .expect(200);
  assert.equal(saved.body.revision, 2);
  f.db
    .update(inventoryItems)
    .set({ revision: Number.MAX_SAFE_INTEGER })
    .where(eq(inventoryItems.id, f.item.id))
    .run();
  await f.api
    .patch(f.path)
    .send({ expected_revision: Number.MAX_SAFE_INTEGER, values: [] })
    .expect(409);
  await f.api
    .delete(f.path)
    .send({ expected_revision: Number.MAX_SAFE_INTEGER })
    .expect(409);
  assert.equal(
    f.services.items.get(f.inventory.id, f.item.id).revision,
    Number.MAX_SAFE_INTEGER,
  );
});
