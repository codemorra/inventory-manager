import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import { createApp } from "../src/app.js";
import { inventoryViews } from "../src/db/schema.js";
import type { ViewPreferences } from "../src/views/validation.js";
import { readExportSnapshot } from "../src/exchange/snapshot.js";

/** Compose memory-only views without implicitly accessing repository settings/files. */
function fixture(context: TestContext) {
  const connection = openDatabase(":memory:");
  context.after(() => connection.close());
  const services = createServices(connection.db);
  const inventory = services.inventories.create({ name: "Views" });
  const fields = ["Title", "Number"].map((name) =>
    services.fields.create(inventory.id, { name, field_type: "text" }),
  );
  const api = request(createApp({ error() {} }, services));
  return {
    ...connection,
    services,
    inventory,
    fields,
    api,
    base: `/inventories/${inventory.id}/view-preferences`,
  };
}
const initial: ViewPreferences = {
  version: 1,
  sort: null,
  hiddenFieldIds: [],
  wrapText: true,
  attachmentPreviews: false,
  columnWidths: {},
};

// Missing rows are defaults, and stored views do not consume domain revisions or appear in exchange manifests.
test("stores independent inventory views without altering configuration, items or archive exchange", async (context) => {
  const f = fixture(context);
  const item = f.services.items.create(f.inventory.id, { values: [] });
  const before = readExportSnapshot(f.db, f.inventory.id).fingerprint;
  assert.deepEqual(f.services.views.read(f.inventory.id), {
    inventory_id: f.inventory.id,
    revision: 0,
    preferences: initial,
  });
  assert.deepEqual(f.services.views.list(), []);
  const preferences = {
    ...initial,
    attachmentPreviews: true,
    wrapText: false,
    hiddenFieldIds: [f.fields[1]!.id],
    columnWidths: { [f.fields[0]!.id]: 130 },
  };
  const saved = f.services.views.update(f.inventory.id, {
    expected_revision: 0,
    preferences,
  });
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.preferences, preferences);
  assert.equal(readExportSnapshot(f.db, f.inventory.id).fingerprint, before);
  assert.equal(
    f.services.items.get(f.inventory.id, item.id).revision,
    item.revision,
  );
  const other = f.services.inventories.create({ name: "Other" });
  assert.deepEqual(f.services.views.read(other.id).preferences, initial);
  assert.deepEqual(f.services.views.list(), [saved]);
});

// Auto has one definition: deleting the persisted manual base; no runtime surplus or extra flags exist.
test("retains manual bases, normalizes stale references and keeps at least one visible column", async (context) => {
  const f = fixture(context);
  const saved = f.services.views.update(f.inventory.id, {
    expected_revision: 0,
    preferences: {
      ...initial,
      sort: { fieldId: f.fields[0]!.id, direction: "ascending" },
      hiddenFieldIds: f.fields.map((field) => field.id),
      columnWidths: {
        [f.fields[0]!.id]: 48,
        [f.fields[1]!.id]: 32768,
        obsolete: 120,
      },
    },
  });
  assert.deepEqual(saved.preferences.hiddenFieldIds, [f.fields[1]!.id]);
  assert.equal(saved.preferences.sort?.fieldId, f.fields[0]!.id);
  assert.deepEqual(saved.preferences.columnWidths, {
    [f.fields[0]!.id]: 48,
    [f.fields[1]!.id]: 32768,
  });
  f.services.fields.delete(f.inventory.id, f.fields[0]!.id);
  const cleaned = f.services.views.read(f.inventory.id);
  assert.equal(cleaned.preferences.sort, null);
  assert.deepEqual(cleaned.preferences.hiddenFieldIds, []);
  assert.deepEqual(cleaned.preferences.columnWidths, {
    [f.fields[1]!.id]: 32768,
  });
  const automatic = f.services.views.update(f.inventory.id, {
    expected_revision: cleaned.revision,
    preferences: { ...cleaned.preferences, columnWidths: {} },
  });
  assert.deepEqual(automatic.preferences.columnWidths, {});
});

// Legacy browser garbage is sanitized, while already persisted choices win over stale browser migration retries.
test("migrates legacy views once per inventory without overriding saved views", async (context) => {
  const f = fixture(context);
  const migrated = f.services.views.migrate(f.inventory.id, {
    preferences: {
      version: 1,
      wrapText: false,
      attachmentPreviews: "invalid",
      hiddenFieldIds: [f.fields[1]!.id, f.fields[1]!.id, "gone", null],
      columnWidths: { [f.fields[0]!.id]: 123, [f.fields[1]!.id]: 1, gone: 100 },
      sort: { fieldId: f.fields[1]!.id, direction: "descending" },
    },
  });
  assert.deepEqual(migrated.preferences, {
    ...initial,
    wrapText: false,
    hiddenFieldIds: [f.fields[1]!.id],
    columnWidths: { [f.fields[0]!.id]: 123 },
  });
  assert.deepEqual(
    f.services.views.migrate(f.inventory.id, { preferences: initial }),
    migrated,
  );
});

// Full view replacements reject stale windows and invalid schemas without losing existing preferences.
test("enforces public revisions, allowed widths and strict view properties", async (context) => {
  const f = fixture(context);
  const saved = await f.api
    .put(f.base)
    .send({
      expected_revision: 0,
      preferences: { ...initial, wrapText: false },
    })
    .expect(200);
  const stale = await f.api
    .put(f.base)
    .send({ expected_revision: 0, preferences: initial })
    .expect(409);
  assert.equal(stale.body.detail.code, "inventory_view_conflict");
  for (const preferences of [
    { ...initial, automatic: true },
    { ...initial, columnWidths: { [f.fields[0]!.id]: 47 } },
    { ...initial, columnWidths: { [f.fields[0]!.id]: 32769 } },
    { ...initial, wrapText: "false" },
  ])
    await f.api
      .put(f.base)
      .send({ expected_revision: 1, preferences })
      .expect(422);
  assert.deepEqual((await f.api.get(f.base).expect(200)).body, saved.body);
  assert.equal((await f.api.get(f.base)).headers["cache-control"], "no-store");
  await f.api.get("/inventories/missing/view-preferences").expect(404);
  await f.api.get("/application-settings").expect(404);
});

// Deletion clears presentation in its existing transaction, including rollback if a later cascade fails.
test("clears views on inventory deletion and rolls back the clear on a failed cascade", (context) => {
  const f = fixture(context);
  const saved = f.services.views.update(f.inventory.id, {
    expected_revision: 0,
    preferences: initial,
  });
  f.sqlite.exec(
    "CREATE TRIGGER fail_view_delete BEFORE UPDATE ON inventory_fields BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
  );
  assert.throws(
    () => f.services.inventories.delete(f.inventory.id),
    /synthetic failure/,
  );
  assert.deepEqual(f.services.views.read(f.inventory.id), saved);
  f.sqlite.exec("DROP TRIGGER fail_view_delete;");
  f.services.inventories.delete(f.inventory.id);
  assert.deepEqual(f.db.select().from(inventoryViews).all(), []);
  assert.deepEqual(f.services.views.list(), []);
  assert.throws(() => f.services.views.read(f.inventory.id), /not found/);
});

// Storage failures and exhausted revisions preserve the saved view and its revision.
test("rolls back failed view replacements and rejects exhausted revisions", (context) => {
  const f = fixture(context);
  const saved = f.services.views.update(f.inventory.id, {
    expected_revision: 0,
    preferences: initial,
  });
  f.sqlite.exec(
    "CREATE TRIGGER fail_view_update BEFORE UPDATE ON inventory_views BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
  );
  assert.throws(
    () =>
      f.services.views.update(f.inventory.id, {
        expected_revision: saved.revision,
        preferences: { ...initial, wrapText: false },
      }),
    /synthetic failure/,
  );
  assert.deepEqual(f.services.views.read(f.inventory.id), saved);
  f.sqlite.exec("DROP TRIGGER fail_view_update;");
  f.db
    .update(inventoryViews)
    .set({ revision: Number.MAX_SAFE_INTEGER })
    .where(eq(inventoryViews.inventoryId, f.inventory.id))
    .run();
  assert.throws(
    () =>
      f.services.views.update(f.inventory.id, {
        expected_revision: Number.MAX_SAFE_INTEGER,
        preferences: initial,
      }),
    /changed/,
  );
});
