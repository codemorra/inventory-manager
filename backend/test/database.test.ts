import assert from "node:assert/strict";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach } from "node:test";
import { openDatabase, type DatabaseConnection } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import {
  inventories,
  inventoryFields,
  inventoryFieldOptions,
  inventoryItems,
  inventoryItemValues,
} from "../src/db/schema.js";

// Test that upgrading an existing database preserves inventories and adds nullable memberships.
test("adds groups to an existing database without losing inventory data", () => {
  const directory = mkdtempSync(join(tmpdir(), "inventory-group-migration-"));
  directories.push(directory);
  const legacy = join(directory, "legacy");
  mkdirSync(join(legacy, "meta"), { recursive: true });
  copyFileSync(
    new URL("../drizzle/0000_initial_schema.sql", import.meta.url),
    join(legacy, "0000_initial_schema.sql"),
  );
  writeFileSync(
    join(legacy, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [
        {
          idx: 0,
          version: "6",
          when: 1791817571688,
          tag: "0000_initial_schema",
          breakpoints: true,
        },
      ],
    }),
  );
  const path = join(directory, "legacy.db");
  const original = openDatabase(path, legacy);
  connections.push(original);
  original.sqlite
    .prepare(
      "INSERT INTO inventories (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run("existing", "Tools", "Workshop", "2026-01-01", "2026-01-01");
  original.close();
  const upgraded = openDatabase(path);
  connections.push(upgraded);
  const inventory = upgraded.db.select().from(inventories).get();
  assert.equal(inventory?.name, "Tools");
  assert.equal(inventory?.description, "Workshop");
  assert.equal(inventory?.groupId, null);
});

const directories: string[] = [];
const connections: DatabaseConnection[] = [];

// Test a real pre-feature database upgrade, including old values and deletion history.
test("adds field settings with compatible defaults without rewriting legacy rows", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "inventory-field-settings-migration-"),
  );
  directories.push(directory);
  const legacy = join(directory, "legacy");
  mkdirSync(join(legacy, "meta"), { recursive: true });
  for (const name of ["0000_initial_schema", "0001_inventory_groups"]) {
    copyFileSync(
      new URL(`../drizzle/${name}.sql`, import.meta.url),
      join(legacy, `${name}.sql`),
    );
  }
  const journal = JSON.parse(
    readFileSync(
      new URL("../drizzle/meta/_journal.json", import.meta.url),
      "utf8",
    ),
  ) as { entries: unknown[] };
  journal.entries = journal.entries.slice(0, 2);
  writeFileSync(join(legacy, "meta", "_journal.json"), JSON.stringify(journal));
  const path = join(directory, "legacy.db");
  const original = openDatabase(path, legacy);
  connections.push(original);
  original.sqlite.exec(`
    INSERT INTO inventories (id, name, created_at, updated_at) VALUES ('inventory', 'Legacy', '2026-01-01', '2026-01-01');
    INSERT INTO inventory_fields (id, inventory_id, name, field_type, max_length, position, created_at, updated_at)
      VALUES ('field', 'inventory', 'Title', 'text', 120, 0, '2026-01-01', '2026-01-01');
    INSERT INTO inventory_fields (id, inventory_id, name, field_type, position, created_at, updated_at, deleted_at)
      VALUES ('deleted-field', 'inventory', '', 'number', 1, '2026-01-01', '2026-01-01', '2026-02-01');
    INSERT INTO inventory_items (id, inventory_id, created_at, updated_at)
      VALUES ('item', 'inventory', '2026-01-01', '2026-01-01');
    INSERT INTO inventory_item_values (id, item_id, field_id, value, created_at, updated_at)
      VALUES ('value', 'item', 'field', '"Original"', '2026-01-01', '2026-01-01');
  `);
  const tables = [
    "inventories",
    "inventory_fields",
    "inventory_items",
    "inventory_item_values",
  ];
  const before = tables.map((table) =>
    original.sqlite.prepare("SELECT * FROM " + table + " ORDER BY id").all(),
  );
  original.close();
  for (let pass = 0; pass < 2; pass++) {
    const upgraded = openDatabase(path);
    connections.push(upgraded);
    const after = tables.map((table) =>
      upgraded.sqlite.prepare("SELECT * FROM " + table + " ORDER BY id").all(),
    );
    after[1] = (after[1] as Record<string, unknown>[]).map((row) => {
      const {
        is_required,
        is_sortable,
        reuse_deleted_ids,
        last_assigned_id,
        ...existing
      } = row;
      assert.equal(is_required, 0);
      assert.equal(is_sortable, 1);
      assert.equal(reuse_deleted_ids, 0);
      assert.equal(last_assigned_id, 0);
      return existing;
    });
    assert.deepEqual(after, before);
    const field = upgraded.db
      .select()
      .from(inventoryFields)
      .all()
      .find((row) => row.id === "field");
    assert.equal(field?.isRequired, false);
    assert.equal(field?.isSortable, true);
    assert.deepEqual(upgraded.sqlite.pragma("foreign_key_check"), []);
    assert.equal(
      upgraded.sqlite.pragma("integrity_check", { simple: true }),
      "ok",
    );
    upgraded.close();
  }
});

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
    { count: 4 },
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
    { count: 4 },
  );
});

// Test the high-water mark survives restarts even when every assigned item was deleted.
test("persists automatic numbering across database reopen and migration retries", () => {
  const { connection, path } = openTemporaryDatabase();
  const services = createServices(connection.db);
  const inventory = services.inventories.create({ name: "Number persistence" });
  const field = services.fields.create(inventory.id, {
    name: "Number",
    field_type: "id",
  });
  const first = services.items.create(inventory.id, {});
  services.items.delete(inventory.id, first.id);
  connection.close();
  const reopened = openDatabase(path);
  connections.push(reopened);
  const nextServices = createServices(reopened.db);
  assert.equal(
    nextServices.fields.get(inventory.id, field.id).reuseDeletedIds,
    false,
  );
  assert.equal(nextServices.items.create(inventory.id, {}).values[0]?.value, 2);
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
