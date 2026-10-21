import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";

/**
 * Prepare an isolated configuration and its HTTP client.
 * @param context The context responsible for database cleanup.
 * @returns Services, connection, saved definitions, and the editor endpoint.
 */
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const inventory = services.inventories.create({ name: "Collection" });
  const title = services.fields.create(inventory.id, { name: "Title" });
  const category = services.fields.create(inventory.id, {
    name: "Category",
    field_type: "select",
    options: [{ name: "First" }],
  });
  const item = services.items.create(inventory.id, {
    values: [{ field_id: title.id, value: "Original" }],
  });
  const revision = () =>
    services.inventories.get(inventory.id).configurationRevision;
  return {
    ...connection,
    services,
    inventory,
    title,
    category,
    item,
    revision,
    path: `/inventories/${inventory.id}/configuration`,
    api: request(createApp({ error: () => {} }, services)),
  };
}

// Test two complete editor snapshots cannot overwrite one another or partially apply stale operations.
test("reads coherent configuration snapshots and rejects stale drafts atomically", async (context) => {
  const f = fixture(context);
  const first = (await f.api.get(f.path).expect(200)).body;
  const second = (await f.api.get(f.path).expect(200)).body;
  assert.deepEqual(first, second);
  assert.equal(first.inventory.configuration_revision, f.revision());
  assert.deepEqual(
    first.fields.map((field: { id: string }) => field.id),
    [f.title.id, f.category.id],
  );
  const saved = await f.api
    .patch(f.path)
    .send({
      expected_revision: first.inventory.configuration_revision,
      inventory: { name: "First editor" },
      fields: [
        { action: "update", field_id: f.title.id, data: { is_required: true } },
      ],
      options: [
        {
          action: "update",
          field_id: f.category.id,
          option_id: f.category.options[0]!.id,
          data: { name: "Changed" },
        },
      ],
      field_order: [{ field_id: f.category.id }, { field_id: f.title.id }],
    })
    .expect(200);
  assert.ok(
    saved.body.inventory.configuration_revision >
      first.inventory.configuration_revision,
  );
  assert.equal(saved.body.inventory.configuration_revision, f.revision());
  const current = f.services.inventoryEditor.read(f.inventory.id);
  const item = f.services.items.read(f.inventory.id, f.item.id);
  const conflict = await f.api
    .patch(f.path)
    .send({
      expected_revision: second.inventory.configuration_revision,
      inventory: { name: "Stale editor" },
      fields: [
        { action: "delete", field_id: f.title.id },
        { action: "create", data: { name: "Number", field_type: "id" } },
      ],
    })
    .expect(409);
  assert.equal(conflict.body.detail.code, "inventory_configuration_conflict");
  assert.deepEqual(f.services.inventoryEditor.read(f.inventory.id), current);
  assert.deepEqual(f.services.items.read(f.inventory.id, f.item.id), item);
  assert.deepEqual((await f.api.get(f.path).expect(200)).body, saved.body);
});

// Test all existing metadata, field, option, and membership entry points invalidate open editors.
test("tracks individual configuration writes and group removal but ignores unrelated groups", (context) => {
  const f = fixture(context);
  const changes = [
    () =>
      f.services.inventories.update(f.inventory.id, { description: "Changed" }),
    () =>
      f.services.fields.update(f.inventory.id, f.title.id, { name: "Label" }),
    () =>
      f.services.options.update(
        f.inventory.id,
        f.category.id,
        f.category.options[0]!.id,
        { name: "Renamed" },
      ),
    () =>
      f.services.options.create(f.inventory.id, f.category.id, {
        name: "Second",
      }),
    () =>
      f.services.options.delete(
        f.inventory.id,
        f.category.id,
        f.category.options[0]!.id,
      ),
    () => f.services.fields.delete(f.inventory.id, f.title.id),
    () => f.services.fields.create(f.inventory.id, { name: "Extra" }),
  ];
  for (const change of changes) {
    const before = f.revision();
    change();
    assert.ok(f.revision() > before);
  }
  const group = f.services.groups.create({ name: "Group" });
  const before = f.revision();
  const moved = f.services.inventories.update(f.inventory.id, {
    group_id: group.id,
  });
  assert.ok(moved.configurationRevision > before);
  assert.equal(moved.configurationRevision, f.revision());
  f.services.groups.update(group.id, { name: "Renamed group" });
  assert.equal(f.revision(), moved.configurationRevision);
  f.services.groups.delete(group.id);
  assert.ok(f.revision() > moved.configurationRevision);
  assert.equal(f.services.inventories.get(f.inventory.id).groupId, null);
});

// Test item writes and automatic counter increments do not invalidate an unchanged configuration draft.
test("ignores item values and ID allocation while tracking actual field settings", (context) => {
  const f = fixture(context);
  const id = f.services.fields.create(f.inventory.id, {
    name: "Number",
    field_type: "id",
  });
  const before = f.revision();
  const item = f.services.items.create(f.inventory.id, { values: [] });
  f.services.items.update(f.inventory.id, item.id, {
    expected_revision: item.revision,
    values: [{ field_id: f.title.id, value: "Changed" }],
  });
  f.services.items.delete(f.inventory.id, item.id, {
    expected_revision: item.revision + 1,
  });
  f.services.fields.update(f.inventory.id, f.title.id, { name: f.title.name });
  f.services.options.update(
    f.inventory.id,
    f.category.id,
    f.category.options[0]!.id,
    { name: "First" },
  );
  assert.equal(f.revision(), before);
  f.services.fields.update(f.inventory.id, id.id, { reuse_deleted_ids: true });
  assert.ok(f.revision() > before);
});

// Test invalid revision preconditions cannot be coerced and deleted configurations remain unavailable.
test("validates configuration preconditions and returns not-found for deleted inventories", async (context) => {
  const f = fixture(context);
  const before = f.services.inventoryEditor.read(f.inventory.id);
  for (const expected_revision of [
    undefined,
    null,
    0,
    -1,
    1.5,
    "1",
    true,
    Number.MAX_SAFE_INTEGER + 1,
  ])
    await f.api
      .patch(f.path)
      .send(expected_revision === undefined ? {} : { expected_revision })
      .expect(422);
  assert.deepEqual(f.services.inventoryEditor.read(f.inventory.id), before);
  f.services.inventories.delete(f.inventory.id);
  await f.api.get(f.path).expect(404);
  await f.api
    .patch(f.path)
    .send({ expected_revision: before.inventory.configurationRevision })
    .expect(404);
});

// Test failures after a revision claim roll back the entire configuration and automatic ID backfill.
test("rolls back revision claims, metadata, and ID backfills on later validation failure", async (context) => {
  const f = fixture(context);
  const before = f.services.inventoryEditor.read(f.inventory.id);
  const item = f.services.items.read(f.inventory.id, f.item.id);
  await f.api
    .patch(f.path)
    .send({
      expected_revision: f.revision(),
      inventory: { name: "Unsaved" },
      fields: [
        {
          action: "create",
          client_id: "number",
          data: { name: "Number", field_type: "id" },
        },
      ],
      field_order: [],
    })
    .expect(422);
  assert.deepEqual(f.services.inventoryEditor.read(f.inventory.id), before);
  assert.deepEqual(f.services.items.read(f.inventory.id, f.item.id), item);
  f.sqlite.exec(
    "CREATE TRIGGER fail_option BEFORE UPDATE ON inventory_field_options BEGIN SELECT RAISE(ABORT, 'Synthetic failure'); END;",
  );
  await f.api
    .patch(f.path)
    .send({
      expected_revision: f.revision(),
      inventory: { name: "Unsaved" },
      options: [
        {
          action: "update",
          field_id: f.category.id,
          option_id: f.category.options[0]!.id,
          data: { name: "Unsaved" },
        },
      ],
    })
    .expect(500);
  assert.deepEqual(f.services.inventoryEditor.read(f.inventory.id), before);
});

// Test accepted no-op drafts still consume their revision, preventing a repeated stale submission.
test("consumes a revision for every accepted configuration draft", async (context) => {
  const f = fixture(context);
  const expected_revision = f.revision();
  await f.api.patch(f.path).send({ expected_revision }).expect(200);
  assert.equal(f.revision(), expected_revision + 1);
  await f.api.patch(f.path).send({ expected_revision }).expect(409);
});
