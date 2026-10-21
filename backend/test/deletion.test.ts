import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase, type DatabaseConnection } from "../src/db/connection.js";
import {
  fieldTypes,
  inventoryFields,
  inventoryFieldOptions,
  inventoryItems,
  inventoryItemValues,
} from "../src/db/schema.js";
import { createServices } from "../src/services.js";

/**
 * Build isolated deletion targets and an unrelated inventory in the same group.
 * @param context The cleanup context owning the in-memory database.
 * @returns Domain services, HTTP client, and complete saved inventory trees.
 */
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const group = services.groups.create({ name: "Shared group" });
  const createTree = (name: string) => {
    const inventory = services.inventories.create({
      name,
      description: "Description",
      group_id: group.id,
    });
    const text = services.fields.create(inventory.id, { name: "Title" });
    const selection = services.fields.create(inventory.id, {
      name: "Selection",
      field_type: "multiselect",
      options: [{ name: "First" }, { name: "Second" }],
    });
    const automatic = services.fields.create(inventory.id, {
      name: "Number",
      field_type: "id",
    });
    const item = services.items.create(inventory.id, {
      values: [
        { field_id: text.id, value: name },
        { field_id: selection.id, value: [selection.options[0]!.id] },
      ],
    });
    return { inventory, text, selection, automatic, item };
  };
  const target = createTree("Target");
  const other = createTree("Other");
  return {
    ...connection,
    services,
    group,
    target,
    other,
    api: request(createApp({ error: () => {} }, services)),
  };
}

/**
 * Capture all identities, contents, and lifecycle metadata for exact rollback assertions.
 * @param connection The isolated connection being inspected.
 * @returns Every domain table in stable identifier order.
 */
function snapshot(connection: DatabaseConnection) {
  return [
    "inventory_groups",
    "inventories",
    "inventory_fields",
    "inventory_field_options",
    "inventory_items",
    "inventory_item_values",
  ].map((table) =>
    connection.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
  );
}

// Test field deletion preserves the item and unrelated values but clears selection content and option labels.
test("field deletion atomically clears its values and options without touching other data", async (context) => {
  const f = fixture(context);
  const beforeOther = f.services.items.read(
    f.other.inventory.id,
    f.other.item.id,
  );
  const secondItem = f.services.items.create(f.target.inventory.id, {
    values: [
      { field_id: f.target.text.id, value: "Second item" },
      {
        field_id: f.target.selection.id,
        value: [f.target.selection.options[1]!.id],
      },
    ],
  });
  const fieldPath = `/inventories/${f.target.inventory.id}/fields/${f.target.selection.id}`;
  await f.api.delete(fieldPath).expect(204);
  const field = f.db
    .select()
    .from(inventoryFields)
    .where(eq(inventoryFields.id, f.target.selection.id))
    .get()!;
  assert.equal(field.name, "");
  assert.ok(field.deletedAt);
  assert.equal(field.updatedAt, field.deletedAt);
  for (const option of f.db
    .select()
    .from(inventoryFieldOptions)
    .where(eq(inventoryFieldOptions.fieldId, field.id))
    .all()) {
    assert.equal(option.name, "");
    assert.equal(option.deletedAt, field.deletedAt);
    assert.equal(option.updatedAt, field.deletedAt);
  }
  const removedValue = f.db
    .select()
    .from(inventoryItemValues)
    .where(eq(inventoryItemValues.fieldId, field.id))
    .get()!;
  assert.equal(removedValue.value, null);
  assert.equal(removedValue.deletedAt, field.deletedAt);
  assert.equal(removedValue.itemId, f.target.item.id);
  assert.deepEqual(
    f.services.items.read(f.target.inventory.id, f.target.item.id),
    {
      ...f.target.item,
      revision: f.target.item.revision + 1,
      updatedAt: field.deletedAt!,
      values: f.target.item.values.filter(
        (value) => value.fieldId !== field.id,
      ),
    },
  );
  assert.deepEqual(
    f.services.items.read(f.target.inventory.id, secondItem.id),
    {
      ...secondItem,
      revision: secondItem.revision + 1,
      updatedAt: field.deletedAt!,
      values: secondItem.values.filter((value) => value.fieldId !== field.id),
    },
  );
  assert.equal(
    f.db
      .select()
      .from(inventoryItemValues)
      .where(eq(inventoryItemValues.fieldId, field.id))
      .all()
      .filter(
        (value) => value.value === null && value.deletedAt === field.deletedAt,
      ).length,
    2,
  );
  assert.deepEqual(
    f.services.items.read(f.other.inventory.id, f.other.item.id),
    beforeOther,
  );
  assert.deepEqual(f.services.groups.get(f.group.id), f.group);
  await f.api.get(fieldPath).expect(404);
  await f.api.get(`${fieldPath}/options`).expect(404);
  const after = snapshot(f);
  await f.api.delete(fieldPath).expect(404);
  assert.deepEqual(snapshot(f), after);
});

// Test every stored value representation is cleared, not merely hidden or converted into an empty value.
test("field deletion removes content for every field type", (context) => {
  const f = fixture(context);
  const inventory = f.services.inventories.create({ name: "All values" });
  const definitions = fieldTypes.map((field_type) =>
    f.services.fields.create(inventory.id, {
      name: field_type,
      field_type,
      ...(["select", "multiselect"].includes(field_type)
        ? { options: [{ name: "Option" }] }
        : {}),
    }),
  );
  const values = definitions
    .filter((field) => field.fieldType !== "id")
    .map((field) => {
      const value = {
        text: "Content",
        number: 0,
        boolean: false,
        checkbox: true,
        date: "2026-10-21",
        time: "12:30",
        datetime: "2026-10-21T12:30",
        duration: 3600,
        url: { url: "https://example.com", label: "Link" },
        select: field.options[0]?.id,
        multiselect: field.options.map((option) => option.id),
      }[field.fieldType as Exclude<typeof field.fieldType, "id">];
      return { field_id: field.id, value };
    });
  const item = f.services.items.create(inventory.id, { values });
  assert.equal(item.values.length, fieldTypes.length);
  for (const field of definitions) {
    f.services.fields.delete(inventory.id, field.id);
    const removed = f.db
      .select()
      .from(inventoryItemValues)
      .where(eq(inventoryItemValues.fieldId, field.id))
      .get()!;
    assert.equal(removed.value, null);
    assert.ok(removed.deletedAt);
  }
  assert.deepEqual(f.services.items.read(inventory.id, item.id).values, []);
});

// Test inventory deletion clears the entire tree while preserving unrelated inventories and their shared group.
test("inventory deletion clears descendants and retains UUIDs, relationships, and prior tombstones", async (context) => {
  const f = fixture(context);
  const old = "2020-01-01T00:00:00.000Z";
  const previousValue = f.target.item.values.find(
    (value) => value.fieldId === f.target.text.id,
  )!;
  f.services.items.update(f.target.inventory.id, f.target.item.id, {
    ...{
      values: [{ field_id: f.target.text.id, value: "Updated title" }],
    },
    expected_revision: f.services.items.get(
      f.target.inventory.id,
      f.target.item.id,
    ).revision,
  });
  const history = f.db
    .select()
    .from(inventoryItemValues)
    .where(eq(inventoryItemValues.id, previousValue.id))
    .get()!;
  // Simulate legacy deletion behavior without modifying application data or running a global cleanup.
  f.db
    .update(inventoryFields)
    .set({ name: "", deletedAt: old, updatedAt: old })
    .where(eq(inventoryFields.id, f.target.selection.id))
    .run();
  const oldField = f.db
    .select()
    .from(inventoryFields)
    .where(eq(inventoryFields.id, f.target.selection.id))
    .get()!;
  const oldItem = f.db
    .insert(inventoryItems)
    .values({
      inventoryId: f.target.inventory.id,
      deletedAt: old,
      updatedAt: old,
    })
    .returning()
    .get();
  f.db
    .insert(inventoryItemValues)
    .values({
      itemId: oldItem.id,
      fieldId: oldField.id,
      value: [f.target.selection.options[0]!.id],
    })
    .run();
  const otherBefore = {
    inventory: f.services.inventories.get(f.other.inventory.id),
    fields: f.services.fields.list(f.other.inventory.id),
    item: f.services.items.read(f.other.inventory.id, f.other.item.id),
  };
  const before = snapshot(f);
  await f.api.delete(`/inventories/${f.target.inventory.id}`).expect(204);
  const inventory = f.sqlite
    .prepare("SELECT * FROM inventories WHERE id = ?")
    .get(f.target.inventory.id) as {
    name: string;
    description: string | null;
    group_id: string | null;
    deleted_at: string;
    updated_at: string;
  };
  assert.equal(inventory.name, "");
  assert.equal(inventory.description, null);
  assert.equal(inventory.group_id, null);
  assert.ok(inventory.deleted_at);
  assert.equal(inventory.updated_at, inventory.deleted_at);
  for (const field of f.db
    .select()
    .from(inventoryFields)
    .where(eq(inventoryFields.inventoryId, f.target.inventory.id))
    .all()) {
    assert.equal(field.name, "");
    assert.equal(field.inventoryId, f.target.inventory.id);
    assert.ok(field.deletedAt);
  }
  for (const option of f.db
    .select()
    .from(inventoryFieldOptions)
    .where(eq(inventoryFieldOptions.fieldId, f.target.selection.id))
    .all()) {
    assert.equal(option.name, "");
    assert.equal(option.deletedAt, inventory.deleted_at);
  }
  const item = f.db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, f.target.item.id))
    .get()!;
  assert.equal(item.deletedAt, inventory.deleted_at);
  for (const value of f.db
    .select()
    .from(inventoryItemValues)
    .where(eq(inventoryItemValues.itemId, item.id))
    .all()) {
    assert.equal(value.value, null);
    assert.ok(value.deletedAt);
  }
  assert.deepEqual(
    f.db
      .select()
      .from(inventoryItemValues)
      .where(eq(inventoryItemValues.id, history.id))
      .get(),
    history,
  );
  assert.deepEqual(
    f.db
      .select()
      .from(inventoryFields)
      .where(eq(inventoryFields.id, oldField.id))
      .get(),
    oldField,
  );
  assert.deepEqual(
    f.db
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, oldItem.id))
      .get(),
    oldItem,
  );
  const oldItemValue = f.db
    .select()
    .from(inventoryItemValues)
    .where(eq(inventoryItemValues.itemId, oldItem.id))
    .get()!;
  assert.equal(oldItemValue.value, null);
  assert.equal(oldItemValue.deletedAt, inventory.deleted_at);
  assert.deepEqual(
    f.services.inventories.get(f.other.inventory.id),
    otherBefore.inventory,
  );
  assert.deepEqual(
    f.services.fields.list(f.other.inventory.id),
    otherBefore.fields,
  );
  assert.deepEqual(
    f.services.items.read(f.other.inventory.id, f.other.item.id),
    otherBefore.item,
  );
  assert.deepEqual(f.services.groups.get(f.group.id), f.group);
  assert.deepEqual(
    snapshot(f).map((rows) => rows.length),
    before.map((rows) => rows.length),
  );
  await f.api
    .get(`/inventories/${f.target.inventory.id}/items/${item.id}`)
    .expect(404);
});

// Test writes at each deletion stage roll back all earlier changes, including child content.
for (const table of [
  "inventory_item_values",
  "inventory_field_options",
  "inventory_items",
  "inventory_fields",
  "inventories",
]) {
  test(`inventory deletion rolls back when updating ${table} fails`, async (context) => {
    const f = fixture(context);
    const before = snapshot(f);
    f.sqlite.exec(
      `CREATE TRIGGER fail_delete BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'Synthetic deletion failure'); END;`,
    );
    await f.api.delete(`/inventories/${f.target.inventory.id}`).expect(500);
    assert.deepEqual(snapshot(f), before);
  });
}

// Test field deletion has the same rollback guarantees outside the inventory editor.
for (const table of ["inventory_field_options", "inventory_fields"]) {
  test(`field deletion rolls back when updating ${table} fails`, (context) => {
    const f = fixture(context);
    const before = snapshot(f);
    f.sqlite.exec(
      `CREATE TRIGGER fail_delete BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, 'Synthetic deletion failure'); END;`,
    );
    assert.throws(() =>
      f.services.fields.delete(f.target.inventory.id, f.target.selection.id),
    );
    assert.deepEqual(snapshot(f), before);
  });
}

// Test later editor errors restore all erased values, options, metadata, and timestamps.
test("failed editor saves restore field deletion content and reject unrelated identifiers", async (context) => {
  const f = fixture(context);
  const before = snapshot(f);
  await f.api
    .patch(`/inventories/${f.target.inventory.id}/configuration`)
    .send({
      inventory: { name: "Must roll back" },
      fields: [
        { action: "delete", field_id: f.target.selection.id },
        { action: "delete", field_id: f.other.text.id },
      ],
    })
    .expect(404);
  assert.deepEqual(snapshot(f), before);
  await f.api
    .delete(`/inventories/${f.target.inventory.id}/fields/${f.other.text.id}`)
    .expect(404);
  assert.deepEqual(snapshot(f), before);
  assert.equal(
    f.db
      .select()
      .from(inventoryItemValues)
      .where(
        and(
          eq(inventoryItemValues.itemId, f.target.item.id),
          eq(inventoryItemValues.fieldId, f.target.selection.id),
        ),
      )
      .get()?.value instanceof Array,
    true,
  );
});
