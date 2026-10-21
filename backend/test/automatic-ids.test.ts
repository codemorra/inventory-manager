import { itemRevision } from "./helpers/item-revision.js";
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import { inventoryFields, inventoryItems } from "../src/db/schema.js";
import { createServices } from "../src/services.js";

/**
 * Create isolated sequences and an HTTP client without using application data.
 * @param context The cleanup context for this test.
 * @returns The in-memory connection, services, inventory, and client.
 */
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const inventory = services.inventories.create({ name: "Numbered items" });
  return {
    ...connection,
    services,
    inventory,
    api: request(createApp({ error: () => {} }, services)),
  };
}

// Test independent sequences, stable read-only assignments, and editable full replacement.
test("assigns independent numbers and preserves their records during replacement", (context) => {
  const { services, inventory } = fixture(context);
  const first = services.fields.create(inventory.id, {
    name: "Number",
    field_type: "id",
    is_required: true,
  });
  const second = services.fields.create(inventory.id, {
    name: "Other number",
    field_type: "id",
  });
  const title = services.fields.create(inventory.id, { name: "Title" });
  const item = services.items.create(inventory.id, {
    values: [{ field_id: title.id, value: "Before" }],
  });
  assert.deepEqual(
    item.values
      .filter((value) => value.fieldId !== title.id)
      .map((value) => value.value),
    [1, 1],
  );
  const replaced = services.items.update(inventory.id, item.id, {
    ...{},
    expected_revision: services.items.get(inventory.id, item.id).revision,
  });
  assert.deepEqual(
    replaced.values,
    item.values.filter((value) => value.fieldId !== title.id),
  );
  const next = services.items.create(inventory.id, {});
  assert.deepEqual(
    next.values.map((value) => value.value),
    [2, 2],
  );
  const other = services.inventories.create({ name: "Independent" });
  services.fields.create(other.id, { name: "Number", field_type: "id" });
  assert.equal(services.items.create(other.id, {}).values[0]?.value, 1);
  assert.notEqual(first.id, second.id);
});

// Test deletion clears stored content while the high-water mark prevents implicit reuse.
test("does not reuse deleted numbers by default and clears deleted values", (context) => {
  const { services, inventory, sqlite } = fixture(context);
  const field = services.fields.create(inventory.id, {
    name: "Number",
    field_type: "id",
  });
  const first = services.items.create(inventory.id, {});
  const second = services.items.create(inventory.id, {});
  services.items.delete(inventory.id, first.id, {
    expected_revision: services.items.get(inventory.id, first.id).revision,
  });
  services.items.delete(inventory.id, second.id, {
    expected_revision: services.items.get(inventory.id, second.id).revision,
  });
  assert.equal(services.items.create(inventory.id, {}).values[0]?.value, 3);
  const deleted = sqlite
    .prepare(
      "SELECT value, deleted_at FROM inventory_item_values WHERE item_id = ?",
    )
    .get(first.id) as { value: unknown; deleted_at: string };
  assert.equal(deleted.value, null);
  assert.ok(deleted.deleted_at);
  assert.equal(services.fields.get(inventory.id, field.id).lastAssignedId, 3);
});

// Test smallest-gap reuse, uniqueness, and retaining history across setting changes.
test("reuses the smallest free number only when explicitly enabled", (context) => {
  const { services, inventory } = fixture(context);
  const field = services.fields.create(inventory.id, {
    name: "Number",
    field_type: "id",
    reuse_deleted_ids: true,
  });
  const items = Array.from({ length: 4 }, () =>
    services.items.create(inventory.id, {}),
  );
  services.items.delete(inventory.id, items[1]!.id, {
    expected_revision: services.items.get(inventory.id, items[1]!.id).revision,
  });
  services.items.delete(inventory.id, items[3]!.id, {
    expected_revision: services.items.get(inventory.id, items[3]!.id).revision,
  });
  assert.equal(services.items.create(inventory.id, {}).values[0]?.value, 2);
  services.fields.update(inventory.id, field.id, { reuse_deleted_ids: false });
  assert.equal(services.items.create(inventory.id, {}).values[0]?.value, 5);
  services.fields.update(inventory.id, field.id, { reuse_deleted_ids: true });
  assert.equal(services.items.create(inventory.id, {}).values[0]?.value, 4);
  assert.equal(services.items.create(inventory.id, {}).values[0]?.value, 6);
});

// Test deterministic backfill, excluding deleted items and preserving their original metadata.
test("backfills active items by creation time and technical ID", (context) => {
  const { services, inventory, db } = fixture(context);
  const items = Array.from({ length: 4 }, () =>
    services.items.create(inventory.id, {}),
  );
  for (const item of items)
    db.update(inventoryItems)
      .set({ createdAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(inventoryItems.id, item.id))
      .run();
  services.items.delete(inventory.id, items[0]!.id, {
    expected_revision: services.items.get(inventory.id, items[0]!.id).revision,
  });
  const before = services.items.list(inventory.id);
  const field = services.fields.create(inventory.id, {
    name: "Number",
    field_type: "id",
    reuse_deleted_ids: true,
  });
  const expected = before.toSorted((left, right) =>
    left.id < right.id ? -1 : 1,
  );
  expected.forEach((item, index) => {
    const saved = services.items.read(inventory.id, item.id);
    assert.equal(
      saved.values.find((value) => value.fieldId === field.id)?.value,
      index + 1,
    );
    assert.equal(saved.revision, item.revision + 1);
  });
  assert.equal(services.items.create(inventory.id, {}).values[0]?.value, 4);
});

// Test rejected input cannot allocate numbers, alter assignments, or partially save editor drafts.
test("rolls back failed item saves and editor backfills", (context) => {
  const { services, inventory } = fixture(context);
  const id = services.fields.create(inventory.id, {
    name: "Number",
    field_type: "id",
  });
  const required = services.fields.create(inventory.id, {
    name: "Required",
    is_required: true,
  });
  assert.throws(() => services.items.create(inventory.id, {}));
  const item = services.items.create(inventory.id, {
    values: [{ field_id: required.id, value: "Valid" }],
  });
  assert.equal(item.values.find((value) => value.fieldId === id.id)?.value, 1);
  const before = services.items.read(inventory.id, item.id);
  assert.throws(() =>
    services.inventoryEditor.save(inventory.id, {
      fields: [
        { action: "create", data: { name: "Rolled back", field_type: "id" } },
        { action: "delete", field_id: "missing" },
      ],
      expected_revision: services.inventories.get(inventory.id)
        .configurationRevision,
    }),
  );
  assert.equal(services.fields.list(inventory.id).length, 2);
  assert.deepEqual(services.items.read(inventory.id, item.id), before);
  assert.throws(() =>
    services.items.update(inventory.id, item.id, {
      ...{},
      expected_revision: services.items.get(inventory.id, item.id).revision,
    }),
  );
  assert.deepEqual(services.items.read(inventory.id, item.id), before);
});

// Test explicit number injection, strict settings, DTO exposure, and unchanged assignments.
test("rejects client-owned ID values and invalid reuse preferences through the API", async (context) => {
  const { services, inventory, api } = fixture(context);
  const fieldsPath = `/inventories/${inventory.id}/fields`;
  const response = await api
    .post(fieldsPath)
    .send({ name: "Number", field_type: "id" })
    .expect(201);
  assert.equal(response.body.reuse_deleted_ids, false);
  assert.equal(response.body.last_assigned_id, undefined);
  const field = services.fields.list(inventory.id)[0]!;
  const item = services.items.create(inventory.id, {});
  const path = `/inventories/${inventory.id}/items`;
  for (const value of [1, 9, null, "2", false]) {
    const input = { values: [{ field_id: field.id, value }] };
    await api.post(path).send(input).expect(422);
    await api
      .patch(`${path}/${item.id}`)
      .send({
        ...input,
        expected_revision: itemRevision(services, `${path}/${item.id}`),
      })
      .expect(422);
  }
  for (const reuse of [null, "true", 1]) {
    await api
      .post(fieldsPath)
      .send({ name: "Invalid", field_type: "id", reuse_deleted_ids: reuse })
      .expect(422);
    await api
      .patch(`${fieldsPath}/${field.id}`)
      .send({ reuse_deleted_ids: reuse })
      .expect(422);
  }
  await api
    .post(fieldsPath)
    .send({ name: "Text", reuse_deleted_ids: true })
    .expect(422);
  const changed = await api
    .patch(`${fieldsPath}/${field.id}`)
    .send({ reuse_deleted_ids: true })
    .expect(200);
  assert.equal(changed.body.reuse_deleted_ids, true);
  assert.deepEqual(services.items.read(inventory.id, item.id), item);
  assert.equal(services.items.list(inventory.id).length, 1);
});

// Test safe-integer exhaustion fails atomically but explicitly reusable holes remain available.
test("rejects exhausted counters without rounding or consuming an item", async (context) => {
  const { services, inventory, db, api } = fixture(context);
  const field = services.fields.create(inventory.id, {
    name: "Number",
    field_type: "id",
  });
  db.update(inventoryFields)
    .set({ lastAssignedId: Number.MAX_SAFE_INTEGER - 1 })
    .where(eq(inventoryFields.id, field.id))
    .run();
  assert.equal(
    services.items.create(inventory.id, {}).values[0]?.value,
    Number.MAX_SAFE_INTEGER,
  );
  await api.post(`/inventories/${inventory.id}/items`).send({}).expect(422);
  assert.equal(services.items.list(inventory.id).length, 1);
  services.fields.update(inventory.id, field.id, { reuse_deleted_ids: true });
  assert.equal(services.items.create(inventory.id, {}).values[0]?.value, 1);
});

// Test later allocation errors roll back earlier ID assignments in the same item transaction.
test("rolls back every counter when a later ID field is exhausted", (context) => {
  const { services, inventory, db } = fixture(context);
  const first = services.fields.create(inventory.id, {
    name: "First",
    field_type: "id",
  });
  const second = services.fields.create(inventory.id, {
    name: "Second",
    field_type: "id",
  });
  db.update(inventoryFields)
    .set({ lastAssignedId: Number.MAX_SAFE_INTEGER })
    .where(eq(inventoryFields.id, second.id))
    .run();
  assert.throws(() => services.items.create(inventory.id, {}));
  assert.equal(services.fields.get(inventory.id, first.id).lastAssignedId, 0);
  assert.equal(services.items.list(inventory.id).length, 0);
  db.update(inventoryFields)
    .set({ lastAssignedId: 0 })
    .where(eq(inventoryFields.id, second.id))
    .run();
  assert.deepEqual(
    services.items.create(inventory.id, {}).values.map((value) => value.value),
    [1, 1],
  );
});

// Test successful editor backfill across insertion batches and removal without orphaned number content.
test("backfills large drafts atomically and clears values when their ID field is deleted", (context) => {
  const { services, inventory, sqlite } = fixture(context);
  for (let index = 0; index < 205; index++)
    services.items.create(inventory.id, {});
  const saved = services.inventoryEditor.save(inventory.id, {
    fields: [{ action: "create", data: { name: "Number", field_type: "id" } }],
    expected_revision: services.inventories.get(inventory.id)
      .configurationRevision,
  });
  const field = saved.fields[0]!;
  const numbers = services.items
    .list(inventory.id)
    .flatMap((item) => item.values.map((value) => value.value as number))
    .sort((left, right) => left - right);
  assert.deepEqual(
    numbers,
    Array.from({ length: 205 }, (_, index) => index + 1),
  );
  assert.equal(services.items.create(inventory.id, {}).values[0]?.value, 206);
  services.fields.delete(inventory.id, field.id);
  assert.deepEqual(
    services.items.list(inventory.id).flatMap((item) => item.values),
    [],
  );
  assert.equal(
    (
      sqlite
        .prepare(
          "SELECT count(*) AS count FROM inventory_item_values WHERE field_id = ? AND value IS NULL AND deleted_at IS NOT NULL",
        )
        .get(field.id) as { count: number }
    ).count,
    206,
  );
});
