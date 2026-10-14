import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connection.js";
import { inventories, inventoryGroups } from "../src/db/schema.js";
import { createServices } from "../src/services.js";
import { createApp } from "../src/app.js";

/**
 * Create an isolated database and HTTP client for group tests.
 * @param context The test cleanup context.
 * @returns The database, services, and HTTP client.
 */
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const api = request(createApp({ error: () => {} }, services));
  return { ...connection, services, api };
}

// Test group CRUD, membership updates, and preservation of inventory contents.
test("group CRUD preserves inventories and clears their membership on deletion", async (context) => {
  const { api, db, services } = fixture(context);
  const group = services.groups.create({ name: "  Leisure  " });
  assert.equal(group.name, "Leisure");
  const created = await api
    .post("/inventories")
    .send({ name: "Games", group_id: group.id })
    .expect(201);
  const id = created.body.id as string;
  assert.equal(created.body.group_id, group.id);
  const field = services.fields.create(id, {
    name: "Title",
    field_type: "text",
    max_length: 255,
  });
  const item = services.items.create(id, {
    values: [{ field_id: field.id, value: "Synthetic game" }],
  });
  await api
    .patch(`/inventory-groups/${group.id}`)
    .send({ name: "Hobbies" })
    .expect(200);
  assert.equal(
    (await api.get("/inventory-groups").expect(200)).body[0].name,
    "Hobbies",
  );
  await api.delete(`/inventory-groups/${group.id}`).expect(204);
  assert.deepEqual((await api.get("/inventory-groups").expect(200)).body, []);
  const inventory = (await api.get(`/inventories/${id}`).expect(200)).body;
  assert.equal(inventory.group_id, null);
  assert.equal(inventory.name, "Games");
  assert.deepEqual(services.items.list(id), [item]);
  const tombstone = db
    .select()
    .from(inventoryGroups)
    .where(eq(inventoryGroups.id, group.id))
    .get();
  assert.equal(tombstone?.name, "");
  assert.ok(tombstone?.deletedAt);
  await api
    .patch(`/inventories/${id}`)
    .send({ group_id: group.id })
    .expect(404);
});

// Test invalid group names, missing groups, and explicit membership removal.
test("validates group names and assignment targets before changing inventories", async (context) => {
  const { api, services } = fixture(context);
  await api.post("/inventory-groups").send({ name: "   " }).expect(422);
  await api
    .post("/inventory-groups")
    .send({ name: "x".repeat(256) })
    .expect(422);
  await api
    .patch("/inventory-groups/missing")
    .send({ name: "New" })
    .expect(404);
  await api.delete("/inventory-groups/missing").expect(404);
  const group = (
    await api.post("/inventory-groups").send({ name: "Work" }).expect(201)
  ).body;
  const inventory = services.inventories.create({ name: "Tools" });
  await api
    .patch(`/inventories/${inventory.id}`)
    .send({ group_id: group.id })
    .expect(200);
  await api
    .patch(`/inventories/${inventory.id}`)
    .send({ name: "Renamed" })
    .expect(200);
  assert.equal(services.inventories.get(inventory.id).groupId, group.id);
  await api
    .patch(`/inventories/${inventory.id}`)
    .send({ name: "Bad", group_id: "missing" })
    .expect(404);
  assert.equal(services.inventories.get(inventory.id).name, "Renamed");
  await api
    .patch(`/inventories/${inventory.id}`)
    .send({ group_id: null })
    .expect(200);
  assert.equal(services.inventories.get(inventory.id).groupId, null);
  await api
    .post("/inventories")
    .send({ name: "Invalid", group_id: "missing" })
    .expect(404);
});

// Test that deletion failures roll back both the tombstone and membership updates.
test("rolls back group deletion if the tombstone cannot be stored", (context) => {
  const { db, sqlite, services } = fixture(context);
  const group = services.groups.create({ name: "Group" });
  const inventory = services.inventories.create({
    name: "Inventory",
    group_id: group.id,
  });
  sqlite.exec(
    "CREATE TRIGGER fail_group_delete BEFORE UPDATE ON inventory_groups BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
  );
  assert.throws(() => services.groups.delete(group.id));
  assert.equal(services.groups.get(group.id).name, "Group");
  assert.equal(
    db.select().from(inventories).where(eq(inventories.id, inventory.id)).get()
      ?.groupId,
    group.id,
  );
});
