import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";
import { openDatabase, type DatabaseConnection } from "../src/db/connection.js";
import {
  inventories,
  inventoryFields,
  inventoryFieldOptions,
  inventoryItems,
  inventoryItemValues,
} from "../src/db/schema.js";

const directories: string[] = [];
const connections: DatabaseConnection[] = [];

// Helper function to open a temporary database for testing.
function openTemporaryDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "inventory-node-db-"));
  directories.push(directory);
  const path = join(directory, "nested", "inventory.db");
  const connection = openDatabase(path);
  connections.push(connection);
  return { connection, path };
}

// Clean up temporary databases and directories after each test.
afterEach(() => {
  for (const connection of connections.splice(0)) connection.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

// Test that a fresh schema is created and JSON values and tombstones are preserved across repeated migrations.
test("creates a fresh schema and preserves JSON values and tombstones across repeated migrations", () => {
  const { connection, path } = openTemporaryDatabase();
  const { db, sqlite } = connection;
  const tables = [
    inventories,
    inventoryFields,
    inventoryFieldOptions,
    inventoryItems,
    inventoryItemValues,
  ];
  for (const table of tables)
    assert.deepEqual(db.select().from(table).all(), []);
  assert.deepEqual(
    sqlite.prepare("SELECT count(*) AS count FROM __drizzle_migrations").get(),
    { count: 1 },
  );

  const inventory = db
    .insert(inventories)
    .values({ name: "Synthetic tools", description: null })
    .returning()
    .get();
  const field = db
    .insert(inventoryFields)
    .values({
      inventoryId: inventory.id,
      name: "Categories",
      fieldType: "multiselect",
      position: 0,
    })
    .returning()
    .get();
  const option = db
    .insert(inventoryFieldOptions)
    .values({ fieldId: field.id, name: "Workshop", position: 0 })
    .returning()
    .get();
  const item = db
    .insert(inventoryItems)
    .values({ inventoryId: inventory.id })
    .returning()
    .get();
  db.insert(inventoryItemValues)
    .values([
      { itemId: item.id, fieldId: field.id, value: [option.id] },
      {
        itemId: item.id,
        fieldId: field.id,
        value: null,
        deletedAt: "2026-01-01T00:00:00.000Z",
      },
    ])
    .run();
  const before = tables.map((table) => db.select().from(table).all());
  assert.match(inventory.id, /^[0-9a-f-]{36}$/);
  assert.equal(Number.isNaN(Date.parse(inventory.createdAt)), false);
  assert.equal(Number.isNaN(Date.parse(inventory.updatedAt)), false);
  assert.deepEqual(
    before[4]?.map((row) => ("value" in row ? row.value : undefined)),
    [[option.id], null],
  );
  connection.close();
  connection.close();
  assert.equal(sqlite.open, false);

  const reopened = openDatabase(path);
  connections.push(reopened);
  assert.deepEqual(
    tables.map((table) => reopened.db.select().from(table).all()),
    before,
  );
  assert.deepEqual(
    reopened.sqlite
      .prepare("SELECT count(*) AS count FROM __drizzle_migrations")
      .get(),
    { count: 1 },
  );
});

// Test that foreign key constraints are enforced without cascades and that a failed transaction is rolled back.
test("enforces foreign keys without cascades and rolls back a failed transaction", () => {
  const {
    connection: { db, sqlite },
  } = openTemporaryDatabase();
  assert.equal(sqlite.pragma("foreign_keys", { simple: true }), 1);
  const parent = db
    .insert(inventories)
    .values({ name: "Synthetic inventory" })
    .returning()
    .get();
  db.insert(inventoryItems).values({ inventoryId: parent.id }).run();
  assert.throws(
    () => sqlite.prepare("DELETE FROM inventories WHERE id = ?").run(parent.id),
    /FOREIGN KEY constraint failed/,
  );

  assert.throws(() =>
    db.transaction((transaction) => {
      transaction.insert(inventories).values({ name: "Must roll back" }).run();
      transaction
        .insert(inventoryItems)
        .values({ inventoryId: "missing-inventory" })
        .run();
    }),
  );
  assert.deepEqual(db.select().from(inventories).all(), [parent]);
});

// Test that the application fails to start if the migration directory is missing and allows a retry after correcting the issue.
test("fails startup on a missing migration directory and allows a corrected retry", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "inventory-node-failed-migration-"),
  );
  directories.push(directory);
  const path = join(directory, "inventory.db");
  assert.throws(() =>
    openDatabase(path, join(directory, "missing-migrations")),
  );
  const connection = openDatabase(path);
  connections.push(connection);
  assert.deepEqual(connection.db.select().from(inventories).all(), []);
});
