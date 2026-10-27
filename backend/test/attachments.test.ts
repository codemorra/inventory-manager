import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  writeFile,
  utimes,
  symlink,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { eq } from "drizzle-orm";
import { openDatabase } from "../src/db/connection.js";
import { inventoryAttachments } from "../src/db/schema.js";
import { createServices } from "../src/services.js";
import { createApp } from "../src/app.js";
import { stagedAttachmentLifetime } from "../src/attachments/service.js";

/**
 * Create isolated storage and database services, then finish cleanup before closing either resource.
 * @param context The test cleanup context.
 * @returns Temporary storage, services, attachment field, and an HTTP client.
 */
async function fixture(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "inventory-attachments-"));
  const connection = openDatabase(":memory:");
  const services = createServices(connection.db, { directory });
  const files = services.attachments!;
  context.after(async () => {
    try {
      await files.cleanup();
    } finally {
      connection.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  const inventory = services.inventories.create({ name: "Files" });
  const field = services.fields.create(inventory.id, {
    name: "Documents",
    field_type: "attachment",
  });
  const errors: unknown[] = [];
  const api = request(
    createApp(
      {
        error: (...args: unknown[]) => {
          errors.push(args);
        },
      },
      services,
    ),
  );
  const base = `/inventories/${inventory.id}/fields/${field.id}/attachments`;
  return {
    ...connection,
    directory,
    services,
    files,
    inventory,
    field,
    api,
    base,
    errors,
  };
}

/**
 * Upload synthetic bytes without invoking HTTP or touching any source file.
 * @param f The isolated fixture.
 * @param filename The display name for the managed copy.
 * @param content The synthetic file content.
 * @returns A staged attachment.
 */
function stage(
  f: Awaited<ReturnType<typeof fixture>>,
  filename = "sample.txt",
  content = "Synthetic data",
) {
  return f.files.upload(
    f.inventory.id,
    f.field.id,
    { filename, media_type: "text/plain" },
    Readable.from([Buffer.from(content)]),
  );
}

/**
 * Snapshot every domain table, including all lifecycle and revision metadata.
 * @param f The isolated database fixture.
 * @returns Complete ordered records for rollback comparisons.
 */
function snapshot(f: Awaited<ReturnType<typeof fixture>>) {
  return [
    "inventories",
    "inventory_groups",
    "inventory_fields",
    "inventory_field_options",
    "inventory_items",
    "inventory_item_values",
    "inventory_templates",
    "inventory_attachments",
  ].map((table) =>
    f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
  );
}

// Public upload/download uses opaque identities, safe display metadata, and mandatory download headers.
test("streams staged files, binds multiple files atomically, and exposes safe download metadata", async (context) => {
  const f = await fixture(context);
  const bytes = Buffer.from([0, 1, 2, 255, 0, 100]);
  const uploaded = await f.api
    .post(f.base)
    .set("Content-Type", "application/octet-stream")
    .set("X-File-Name", encodeURIComponent("Prüfung.pdf"))
    .set("X-File-Type", "application/pdf")
    .send(bytes)
    .expect(201);
  const file = uploaded.body;
  assert.equal(file.filename, "Prüfung.pdf");
  assert.equal(file.item_id, null);
  assert.equal(file.byte_size, bytes.length);
  assert.equal("sha256" in file, false);
  assert.equal("path" in file, false);
  assert.equal("storage_purged" in file, false);
  assert.deepEqual(await readFile(join(f.directory, `${file.id}.blob`)), bytes);
  const stored = f.files.get(f.inventory.id, f.field.id, file.id);
  assert.equal(stored.sha256, createHash("sha256").update(bytes).digest("hex"));
  const second = await stage(f, "other.txt", "Second file");
  const created = await f.api
    .post(`/inventories/${f.inventory.id}/items`)
    .send({ values: [{ field_id: f.field.id, value: [second.id, file.id] }] })
    .expect(201);
  assert.deepEqual(created.body.values[0].value, [second.id, file.id]);
  assert.equal(created.body.attachments.length, 2);
  assert.ok(
    created.body.attachments.every(
      (entry: { item_id: string }) => entry.item_id === created.body.id,
    ),
  );
  const read = await f.api
    .get(`/inventories/${f.inventory.id}/items/${created.body.id}`)
    .expect(200);
  assert.deepEqual(read.body, created.body);
  const downloaded = await f.api
    .get(`${f.base}/${file.id}/download`)
    .expect(200);
  assert.deepEqual(downloaded.body, bytes);
  assert.match(downloaded.headers["content-disposition"]!, /^attachment;/);
  assert.match(downloaded.headers["content-disposition"]!, /filename\*/);
  assert.equal(downloaded.headers["content-type"], "application/octet-stream");
  assert.equal(downloaded.headers["x-content-type-options"], "nosniff");
  assert.equal(downloaded.headers["cache-control"], "no-store");
  const before = snapshot(f);
  await f.api.delete(`${f.base}/${file.id}`).expect(409);
  assert.deepEqual(snapshot(f), before);
  await f.api.get(`${f.base}/${file.id}`).expect(200);
});

// Invalid upload metadata never consumes revisions or leaves managed files behind.
test("rejects bad names, media types, and field scopes without residue", async (context) => {
  const f = await fixture(context);
  const before = snapshot(f);
  for (const filename of [
    "",
    "%ZZ",
    encodeURIComponent("../outside"),
    encodeURIComponent("a\\file"),
    encodeURIComponent("bad\nname"),
    ".",
    "..",
    "a".repeat(256),
  ]) {
    await f.api
      .post(f.base)
      .set("Content-Type", "application/octet-stream")
      .set("X-File-Name", filename)
      .send(Buffer.from("data"))
      .expect(422);
  }
  await f.api
    .post(f.base)
    .set("Content-Type", "text/plain")
    .set("X-File-Name", "test.txt")
    .send("data")
    .expect(422);
  await f.api
    .post(f.base)
    .set("Content-Type", "application/octet-stream")
    .set("X-File-Name", "test.txt")
    .set("X-File-Type", "invalid")
    .send(Buffer.from("data"))
    .expect(422);
  assert.deepEqual(snapshot(f), before);
  assert.deepEqual(await readdir(f.directory), []);
  const text = f.services.fields.create(f.inventory.id, { name: "Text" });
  await f.api
    .post(`/inventories/${f.inventory.id}/fields/${text.id}/attachments`)
    .set("Content-Type", "application/octet-stream")
    .set("X-File-Name", "test")
    .send(Buffer.from("data"))
    .expect(422);
  await f.api.get(`${f.base}/missing/download`).expect(404);
});

// File IDs cannot be reassigned across fields, inventories, or saved items, even via item replacement.
test("validates attachment references and ownership before committing item values", async (context) => {
  const f = await fixture(context);
  const file = await stage(f);
  const secondField = f.services.fields.create(f.inventory.id, {
    name: "Other files",
    field_type: "attachment",
  });
  const otherInventory = f.services.inventories.create({ name: "Other" });
  const foreignField = f.services.fields.create(otherInventory.id, {
    name: "Files",
    field_type: "attachment",
  });
  const item = f.services.items.create(f.inventory.id, {
    values: [{ field_id: f.field.id, value: [file.id] }],
  });
  const before = snapshot(f);
  for (const values of [
    [{ field_id: f.field.id, value: [file.id] }],
    [{ field_id: secondField.id, value: [file.id] }],
    [{ field_id: f.field.id, value: [file.id, file.id] }],
    [{ field_id: f.field.id, value: ["missing"] }],
    [{ field_id: f.field.id, value: [] }],
    [{ field_id: f.field.id, value: file.id }],
    [{ field_id: f.field.id, value: [false] }],
  ])
    assert.throws(
      () => f.services.items.create(f.inventory.id, { values }),
      /Attachment|invalid/,
    );
  assert.throws(
    () =>
      f.services.items.create(otherInventory.id, {
        values: [{ field_id: foreignField.id, value: [file.id] }],
      }),
    /Attachment/,
  );
  assert.deepEqual(snapshot(f), before);
  await f.api
    .get(
      `/inventories/${otherInventory.id}/fields/${foreignField.id}/attachments/${file.id}/download`,
    )
    .expect(404);
  const unchanged = f.services.items.update(f.inventory.id, item.id, {
    expected_revision: item.revision,
    values: [{ field_id: f.field.id, value: [file.id] }],
  });
  assert.equal(unchanged.attachments?.[0]?.id, file.id);
});

// Removing one reference clears metadata only after successful item revision checking; the worker removes bytes.
test("replaces file lists with revision protection and clears removed content after commit", async (context) => {
  const f = await fixture(context);
  const first = await stage(f, "first.txt");
  const second = await stage(f, "second.txt");
  const item = f.services.items.create(f.inventory.id, {
    values: [{ field_id: f.field.id, value: [first.id, second.id] }],
  });
  const before = snapshot(f);
  assert.throws(
    () =>
      f.services.items.update(f.inventory.id, item.id, {
        expected_revision: item.revision + 1,
        values: [],
      }),
    /changed/,
  );
  assert.deepEqual(snapshot(f), before);
  f.services.items.update(f.inventory.id, item.id, {
    expected_revision: item.revision,
    values: [{ field_id: f.field.id, value: [second.id] }],
  });
  const removed = f.db
    .select()
    .from(inventoryAttachments)
    .where(eq(inventoryAttachments.id, first.id))
    .get()!;
  assert.equal(removed.filename, "");
  assert.equal(removed.mediaType, "");
  assert.equal(removed.sha256, null);
  assert.equal(removed.byteSize, 0);
  assert.ok(removed.deletedAt);
  await f.files.cleanup();
  await assert.rejects(readFile(join(f.directory, `${first.id}.blob`)), {
    code: "ENOENT",
  });
  assert.ok((await readFile(join(f.directory, `${second.id}.blob`))).length);
  await f.api.get(`${f.base}/${first.id}/download`).expect(404);
});

// Any later row or storage failure rolls back staged claims, removals, revisions, and value tombstones.
test("rolls back attachment ownership and removals together with failed single and multi-row saves", async (context) => {
  const f = await fixture(context);
  const old = await stage(f, "old.txt");
  const staged = await stage(f, "new.txt");
  const first = f.services.items.create(f.inventory.id, {
    values: [{ field_id: f.field.id, value: [old.id] }],
  });
  const second = f.services.items.create(f.inventory.id, {});
  const before = snapshot(f);
  assert.throws(
    () =>
      f.services.items.updateMany(f.inventory.id, {
        expected_configuration_revision: f.services.inventories.get(
          f.inventory.id,
        ).configurationRevision,
        items: [
          {
            item_id: first.id,
            expected_revision: first.revision,
            values: [{ field_id: f.field.id, value: [staged.id] }],
          },
          {
            item_id: second.id,
            expected_revision: second.revision + 1,
            values: [],
          },
        ],
      }),
    /changed/,
  );
  assert.deepEqual(snapshot(f), before);
  f.sqlite.exec(
    "CREATE TRIGGER fail_attachment_values BEFORE INSERT ON inventory_item_values BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
  );
  assert.throws(
    () =>
      f.services.items.update(f.inventory.id, first.id, {
        expected_revision: first.revision,
        values: [{ field_id: f.field.id, value: [staged.id] }],
      }),
    /synthetic failure/,
  );
  assert.deepEqual(snapshot(f), before);
  await f.files.cleanup();
  assert.equal(f.files.get(f.inventory.id, f.field.id, staged.id).itemId, null);
  assert.equal(
    f.files.get(f.inventory.id, f.field.id, old.id).itemId,
    first.id,
  );
  assert.equal((await readdir(f.directory)).length, 2);
});

// Database publication and interrupted uploads cannot leave a downloadable record or a partial managed copy.
test("cleans interrupted streams, failed metadata writes, and fields deleted during streaming", async (context) => {
  const f = await fixture(context);
  const broken = Readable.from(
    (async function* () {
      yield Buffer.from("partial");
      throw new Error("interrupted");
    })(),
  );
  await assert.rejects(
    f.files.upload(f.inventory.id, f.field.id, { filename: "partial" }, broken),
    /interrupted/,
  );
  assert.deepEqual(await readdir(f.directory), []);
  f.sqlite.exec(
    "CREATE TRIGGER fail_attachment_metadata BEFORE INSERT ON inventory_attachments BEGIN SELECT RAISE(ABORT, 'metadata failure'); END",
  );
  await assert.rejects(stage(f), /metadata failure/);
  assert.deepEqual(await readdir(f.directory), []);
  f.sqlite.exec("DROP TRIGGER fail_attachment_metadata");
  const concurrent = Readable.from(
    (async function* () {
      yield Buffer.from("first");
      f.services.fields.delete(f.inventory.id, f.field.id);
      yield Buffer.from("last");
    })(),
  );
  await assert.rejects(
    f.files.upload(
      f.inventory.id,
      f.field.id,
      { filename: "deleted" },
      concurrent,
    ),
    /not found/,
  );
  assert.deepEqual(await readdir(f.directory), []);
  assert.deepEqual(f.db.select().from(inventoryAttachments).all(), []);
});

// Cascades include bound attachments and abandoned uploads while preserving unrelated inventories.
for (const target of ["item", "field", "inventory"] as const)
  test(`${target} deletion clears dependent attachment metadata and bytes without affecting other records`, async (context) => {
    const f = await fixture(context);
    const bound = await stage(f, "bound.txt");
    const staged = await stage(f, "staged.txt");
    const item = f.services.items.create(f.inventory.id, {
      values: [{ field_id: f.field.id, value: [bound.id] }],
    });
    const other = f.services.inventories.create({ name: "Untouched" });
    const otherField = f.services.fields.create(other.id, {
      name: "Files",
      field_type: "attachment",
    });
    const unrelated = await f.files.upload(
      other.id,
      otherField.id,
      { filename: "other.txt" },
      Readable.from(["Untouched"]),
    );
    if (target === "item")
      f.services.items.delete(f.inventory.id, item.id, {
        expected_revision: item.revision,
      });
    if (target === "field")
      f.services.fields.delete(f.inventory.id, f.field.id);
    if (target === "inventory") f.services.inventories.delete(f.inventory.id);
    await f.files.cleanup();
    for (const id of target === "item" ? [bound.id] : [bound.id, staged.id]) {
      const row = f.db
        .select()
        .from(inventoryAttachments)
        .where(eq(inventoryAttachments.id, id))
        .get()!;
      assert.equal(row.filename, "");
      assert.equal(row.storagePurged, true);
      assert.ok(row.deletedAt);
      await assert.rejects(readFile(join(f.directory, `${id}.blob`)), {
        code: "ENOENT",
      });
    }
    assert.deepEqual(
      f.files.get(other.id, otherField.id, unrelated.id),
      unrelated,
    );
    assert.equal(
      (await readFile(join(f.directory, `${unrelated.id}.blob`))).toString(),
      "Untouched",
    );
    if (target === "item")
      assert.equal(
        f.files.get(f.inventory.id, f.field.id, staged.id).itemId,
        null,
      );
  });

// Filesystem failures keep retryable tombstones; a later sweep completes removal idempotently.
test("retries failed physical deletion without reviving metadata or changing deletion history", async (context) => {
  const f = await fixture(context);
  const file = await stage(f);
  f.files.discard(f.inventory.id, f.field.id, file.id);
  const deleted = f.db
    .select()
    .from(inventoryAttachments)
    .where(eq(inventoryAttachments.id, file.id))
    .get()!;
  const path = join(f.directory, `${file.id}.blob`);
  await rm(path);
  await mkdir(path);
  await assert.rejects(f.files.cleanup(), /cleanup failed/);
  assert.equal(
    f.db
      .select()
      .from(inventoryAttachments)
      .where(eq(inventoryAttachments.id, file.id))
      .get()!.storagePurged,
    false,
  );
  await rm(path, { recursive: true });
  await writeFile(path, "leftover");
  await f.files.cleanup();
  const purged = f.db
    .select()
    .from(inventoryAttachments)
    .where(eq(inventoryAttachments.id, file.id))
    .get()!;
  assert.equal(purged.storagePurged, true);
  assert.equal(purged.updatedAt, deleted.updatedAt);
  assert.equal(purged.deletedAt, deleted.deletedAt);
  const before = snapshot(f);
  await f.files.cleanup();
  assert.deepEqual(snapshot(f), before);
});

// Expiry touches only abandoned stages, and orphan sweeping is limited to old generated storage names.
test("expires abandoned uploads and old interrupted files while preserving saved and recent files", async (context) => {
  const f = await fixture(context);
  const saved = await stage(f, "saved.txt");
  const abandoned = await stage(f, "abandoned.txt");
  f.services.items.create(f.inventory.id, {
    values: [{ field_id: f.field.id, value: [saved.id] }],
  });
  f.sqlite
    .prepare("UPDATE inventory_attachments SET created_at = ?")
    .run("2000-01-01T00:00:00.000Z");
  const orphan = `${randomUUID()}.upload`;
  const recent = `${randomUUID()}.blob`;
  await writeFile(join(f.directory, orphan), "partial");
  await utimes(join(f.directory, orphan), 0, 0);
  await writeFile(join(f.directory, recent), "recent");
  await writeFile(join(f.directory, "user-file.txt"), "preserved");
  await f.files.cleanup();
  assert.deepEqual(
    (await readdir(f.directory)).sort(),
    [`${saved.id}.blob`, recent, "user-file.txt"].sort(),
  );
  assert.throws(
    () => f.files.get(f.inventory.id, f.field.id, abandoned.id),
    /not found/,
  );
  assert.ok(f.files.get(f.inventory.id, f.field.id, saved.id).itemId);
});

// An open upload remains safe from reconciliation even when its temporary file looks old.
test("does not sweep a currently streaming file", async (context) => {
  const f = await fixture(context);
  const input = Readable.from(
    (async function* () {
      yield Buffer.from("first");
      await f.files.cleanup(
        true,
        Date.now() + stagedAttachmentLifetime + 1_000,
      );
      yield Buffer.from("last");
    })(),
  );
  const file = await f.files.upload(
    f.inventory.id,
    f.field.id,
    { filename: "active" },
    input,
  );
  assert.equal(
    (await readFile(join(f.directory, `${file.id}.blob`))).toString(),
    "firstlast",
  );
});

// Download endpoints never follow a substituted symlink or return a mismatched-size managed file.
test("rejects missing, substituted, or corrupt file content without exposing filesystem paths", async (context) => {
  const f = await fixture(context);
  const file = await stage(f);
  const path = join(f.directory, `${file.id}.blob`);
  await rm(path);
  await f.api.get(`${f.base}/${file.id}/download`).expect(404);
  const outside = join(f.directory, "unmanaged.txt");
  await writeFile(outside, "private");
  await symlink(outside, path);
  await f.api
    .get(`${f.base}/${file.id}/download`)
    .expect(500, { detail: "Internal Server Error" });
  await rm(path);
  await writeFile(path, "wrong size");
  await f.api
    .get(`${f.base}/${file.id}/download`)
    .expect(500, { detail: "Internal Server Error" });
});

// Failed parent cascades must not schedule physical deletion or consume any saved revision.
test("rolls back attachment metadata during failed item, field, and inventory deletions", async (context) => {
  const f = await fixture(context);
  const file = await stage(f);
  const item = f.services.items.create(f.inventory.id, {
    values: [{ field_id: f.field.id, value: [file.id] }],
  });
  const before = snapshot(f);
  f.sqlite.exec(
    "CREATE TRIGGER fail_attachment_cascade BEFORE UPDATE OF value ON inventory_item_values BEGIN SELECT RAISE(ABORT, 'cascade failure'); END",
  );
  for (const operation of [
    () =>
      f.services.items.delete(f.inventory.id, item.id, {
        expected_revision: item.revision,
      }),
    () => f.services.fields.delete(f.inventory.id, f.field.id),
    () => f.services.inventories.delete(f.inventory.id),
  ]) {
    assert.throws(operation, /cascade failure/);
    assert.deepEqual(snapshot(f), before);
    await f.files.cleanup();
    assert.equal(
      (await readFile(join(f.directory, `${file.id}.blob`))).toString(),
      "Synthetic data",
    );
  }
});

// A real upgrade preserves existing data, and committed file references/bytes survive restarts.
test("migrates an existing database and preserves managed files and ownership across restart", async (context) => {
  const directory = await mkdtemp(
    join(tmpdir(), "inventory-attachment-migration-"),
  );
  const migrations = join(directory, "legacy");
  await mkdir(join(migrations, "meta"), { recursive: true });
  const journal = JSON.parse(
    await readFile(
      new URL("../drizzle/meta/_journal.json", import.meta.url),
      "utf8",
    ),
  ) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(0, 7);
  for (const entry of journal.entries)
    await writeFile(
      join(migrations, `${entry.tag}.sql`),
      await readFile(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url)),
    );
  await writeFile(
    join(migrations, "meta", "_journal.json"),
    JSON.stringify(journal),
  );
  let connection = openDatabase(join(directory, "inventory.db"), migrations);
  context.after(async () => {
    connection.close();
    await rm(directory, { recursive: true, force: true });
  });
  connection.sqlite.exec(
    "INSERT INTO inventories (id, name, description, created_at, updated_at, configuration_revision) VALUES ('existing', 'Existing', 'Untouched', '2026-01-01', '2026-01-01', 9)",
  );
  const previous = connection.sqlite.prepare("SELECT * FROM inventories").all();
  connection.close();
  connection = openDatabase(join(directory, "inventory.db"));
  assert.deepEqual(
    connection.sqlite.prepare("SELECT * FROM inventories").all(),
    previous,
  );
  const services = createServices(connection.db, {
    directory: join(directory, "attachments"),
  });
  const field = services.fields.create("existing", {
    name: "Files",
    field_type: "attachment",
  });
  const file = await services.attachments!.upload(
    "existing",
    field.id,
    { filename: "saved.txt" },
    Readable.from(["Persisted bytes"]),
  );
  const item = services.items.create("existing", {
    values: [{ field_id: field.id, value: [file.id] }],
  });
  const before = connection.db.select().from(inventoryAttachments).all();
  connection.close();
  connection = openDatabase(join(directory, "inventory.db"));
  const reopened = createServices(connection.db, {
    directory: join(directory, "attachments"),
  });
  assert.deepEqual(
    connection.db.select().from(inventoryAttachments).all(),
    before,
  );
  assert.deepEqual(reopened.items.read("existing", item.id), item);
  assert.equal(
    (
      await readFile(join(directory, "attachments", `${file.id}.blob`))
    ).toString(),
    "Persisted bytes",
  );
  assert.deepEqual(connection.sqlite.pragma("foreign_key_check"), []);
  assert.equal(
    connection.sqlite.pragma("integrity_check", { simple: true }),
    "ok",
  );
});

// Large local files remain uploadable; chunks stream to disk without a whole-file memory buffer.
test("accepts streamed files larger than the removed 50 MiB application limit", async (context) => {
  const f = await fixture(context);
  const chunk = Buffer.alloc(1024 * 1024, 90);
  const content = Readable.from(
    (async function* () {
      for (let index = 0; index < 51; index++) yield chunk;
    })(),
  );
  const file = await f.files.upload(
    f.inventory.id,
    f.field.id,
    { filename: "large-local-file.bin" },
    content,
  );
  assert.equal(file.byteSize, 51 * 1024 * 1024);
  assert.equal(
    (await stat(join(f.directory, `${file.id}.blob`))).size,
    file.byteSize,
  );
  const item = f.services.items.create(f.inventory.id, {
    values: [{ field_id: f.field.id, value: [file.id] }],
  });
  assert.equal(item.attachments?.[0]?.byteSize, file.byteSize);
});
