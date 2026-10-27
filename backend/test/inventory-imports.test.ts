import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable, PassThrough } from "node:stream";
import { crc32, deflateSync } from "node:zlib";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import { readExportSnapshot } from "../src/exchange/snapshot.js";
import type { InventoryManifest } from "../src/exchange/manifest.js";
import {
  importSessionLifetime,
  maxArchiveEntries,
  maxManifestBytes,
} from "../src/exchange/limits.js";
import {
  inventories,
  inventoryFields,
  inventoryFieldOptions,
  inventoryItems,
  inventoryItemValues,
  inventoryAttachments,
} from "../src/db/schema.js";

/**
 * Use a migrated in-memory DB and isolated filesystem; never open development data.
 * @param context The cleanup scope.
 * @returns Real services, public API and temporary paths.
 */
async function fixture(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "inventory-import-test-"));
  const connection = openDatabase(":memory:");
  const services = createServices(connection.db, { directory });
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
  context.after(async () => {
    connection.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    ...connection,
    directory,
    services,
    imports: services.imports!,
    api,
    errors,
  };
}

type F = Awaited<ReturnType<typeof fixture>>;
const emptyManifest = (): InventoryManifest => ({
  format: "inventory-manager",
  version: 1,
  inventory: { name: "Imported", description: "Saved description" },
  fields: [],
  items: [],
  attachments: [],
});
interface ZipEntry {
  name: string;
  body: Buffer;
  mode?: number;
  method?: number;
  flags?: number;
  size?: number;
  crc?: number;
}

/**
 * Build tiny independent stored ZIP fixtures, including deliberately invalid metadata.
 * @param entries Arbitrary central/local names, headers and synthetic contents.
 * @returns The test-only ZIP bytes; production code never buffers archives this way.
 */
function zip(entries: ZipEntry[]) {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.flags ?? 0x800, 6);
    header.writeUInt16LE(entry.method ?? 0, 8);
    header.writeUInt32LE(entry.crc ?? crc32(entry.body), 14);
    header.writeUInt32LE(entry.body.length, 18);
    header.writeUInt32LE(entry.size ?? entry.body.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, entry.body);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(0x033f, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(entry.flags ?? 0x800, 8);
    record.writeUInt16LE(entry.method ?? 0, 10);
    record.writeUInt32LE(entry.crc ?? crc32(entry.body), 16);
    record.writeUInt32LE(entry.body.length, 20);
    record.writeUInt32LE(entry.size ?? entry.body.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(((entry.mode ?? 0o100600) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, name);
    offset += header.length + name.length + entry.body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/**
 * Create a plain version-1 archive with optional original bytes.
 * @param manifest The JSON manifest or deliberately malformed override.
 * @param entries Other archive entries.
 * @returns Small stored ZIP fixture bytes.
 */
function archive(
  manifest: unknown = emptyManifest(),
  entries: ZipEntry[] = [],
) {
  return zip([
    { name: "inventory.json", body: Buffer.from(JSON.stringify(manifest)) },
    ...entries,
  ]);
}

/**
 * Snapshot every import-affected table to verify no partial publication or source mutation.
 * @param f The isolated fixture.
 * @returns Every row including tombstones and revision metadata.
 */
function state(f: F) {
  return [
    inventories,
    inventoryFields,
    inventoryFieldOptions,
    inventoryItems,
    inventoryItemValues,
    inventoryAttachments,
  ].map((table) => f.db.select().from(table).all());
}

/**
 * Stage one synthetic original and its exact manifest representation.
 * @param body The tiny test payload.
 * @returns A fully referenced file manifest and matching ZIP entries.
 */
function fileArchive(body = Buffer.from("File bytes")) {
  const manifest = emptyManifest();
  manifest.fields.push({
    key: "files",
    name: "Files",
    field_type: "attachment",
    max_length: null,
    is_required: false,
    is_sortable: true,
    reuse_deleted_ids: false,
    last_assigned_id: 0,
    options: [],
  });
  manifest.items.push({
    key: "entry",
    values: [{ field: "files", value: ["a1"] }],
  });
  manifest.attachments.push({
    key: "a1",
    field: "files",
    item: "entry",
    filename: "Prüfung.txt",
    media_type: "text/plain",
    byte_size: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  });
  return {
    manifest,
    entries: [{ name: "attachments/a1", body }],
    bytes: archive(manifest, [{ name: "attachments/a1", body }]),
  };
}

// Exercise actual exported bytes, every type, historical exceptions and independent file ownership.
test("round-trips all field types, original files, saved history, counters and explicit item order", async (context) => {
  const f = await fixture(context);
  const source = f.services.inventories.create({
    name: "Prüfung",
    description: "Source metadata",
  });
  const definitions = [
    ["ID", "id", undefined],
    ["Reusable", "id", undefined],
    ["Text", "text", "Synthetic"],
    ["Number", "number", 0],
    ["Boolean", "boolean", false],
    ["Checkbox", "checkbox", true],
    ["Date", "date", "2026-10-27"],
    ["Time", "time", "12:34"],
    ["Datetime", "datetime", "2026-10-27T12:34"],
    ["Duration", "duration", 61],
    ["Link", "url", { url: "https://example.com", label: "Example" }],
    ["Select", "select", undefined],
    ["Multiselect", "multiselect", undefined],
    ["Files", "attachment", undefined],
  ] as const;
  const fields = definitions.map(([name, field_type]) =>
    f.services.fields.create(source.id, {
      name,
      field_type,
      reuse_deleted_ids: name === "Reusable",
      ...(["select", "multiselect"].includes(field_type)
        ? {
            options: [{ name: "Removed" }, { name: "Kept" }, { name: "Other" }],
          }
        : {}),
    }),
  );
  const fileField = fields.at(-1)!;
  const firstRemoved = f.services.items.create(source.id, { values: [] });
  const sourceRows = [];
  for (const [index, body] of ["First file", ""].entries()) {
    const file = await f.services.attachments!.upload(
      source.id,
      fileField.id,
      { filename: "Prüfung.txt", media_type: "text/plain" },
      Readable.from([Buffer.from(body)]),
    );
    const item = f.services.items.create(source.id, {
      values: fields.flatMap((field, i) =>
        field.fieldType === "id"
          ? []
          : [
              {
                field_id: field.id,
                value:
                  field.fieldType === "select"
                    ? field.options[0]!.id
                    : field.fieldType === "multiselect"
                      ? field.options.map((o) => o.id)
                      : field.fieldType === "attachment"
                        ? [file.id]
                        : definitions[i]![2],
              },
            ],
      ),
    });
    f.db
      .update(inventoryItems)
      .set({
        createdAt: new Date(Date.now() - (index + 1) * 100).toISOString(),
      })
      .where(eq(inventoryItems.id, item.id))
      .run();
    sourceRows.push(item);
  }
  const lastRemoved = f.services.items.create(source.id, { values: [] });
  for (const item of [firstRemoved, lastRemoved])
    f.services.items.delete(source.id, item.id, {
      expected_revision: item.revision,
    });
  for (const field of fields.filter((field) =>
    ["select", "multiselect"].includes(field.fieldType),
  )) {
    f.services.options.delete(source.id, field.id, field.options[0]!.id);
    f.services.options.update(source.id, field.id, field.options[2]!.id, {
      name: "Kept",
    });
  }
  f.services.fields.create(source.id, {
    name: "Later required",
    field_type: "text",
    is_required: true,
  });
  const sourceSnapshot = readExportSnapshot(f.db, source.id);
  const before = state(f);
  const exported = await f.services.exports!.create(source.id);
  const preview = await f.imports.prepare(createReadStream(exported.path));
  await exported.dispose();
  assert.equal(preview.field_count, 15);
  assert.equal(preview.item_count, 2);
  assert.equal(preview.attachment_count, 2);
  assert.equal(preview.attachment_bytes, Buffer.byteLength("First file"));
  assert.deepEqual(state(f), before);
  const group = f.services.groups.create({ name: "Destination" });
  const imported = await f.imports.confirm(preview.id, {
    name: "Independent copy",
    group_id: group.id,
  });
  assert.notEqual(imported.id, source.id);
  assert.equal(imported.groupId, group.id);
  const result = readExportSnapshot(f.db, imported.id);
  assert.deepEqual(result.manifest, {
    ...sourceSnapshot.manifest,
    inventory: {
      ...sourceSnapshot.manifest.inventory,
      name: "Independent copy",
    },
  });
  for (const file of result.sources) {
    assert.ok(
      !sourceSnapshot.sources.some((sourceFile) => sourceFile.id === file.id),
    );
    const download = await f.services.attachments!.download(
      imported.id,
      file.fieldId,
      file.id,
    );
    const chunks = [];
    for await (const chunk of download.stream) chunks.push(Buffer.from(chunk));
    assert.equal(
      createHash("sha256").update(Buffer.concat(chunks)).digest("hex"),
      file.sha256,
    );
  }
  const targetFields = f.services.fields.list(imported.id);
  assert.ok(
    targetFields.every(
      (field) => !fields.some((sourceField) => sourceField.id === field.id),
    ),
  );
  assert.equal(
    f.services.options.list(
      imported.id,
      targetFields.find((field) => field.fieldType === "select")!.id,
    ).length,
    2,
  );
  const next = f.services.items.create(imported.id, {
    values: [
      {
        field_id: targetFields.find((field) => field.name === "Later required")!
          .id,
        value: "Now supplied",
      },
    ],
  });
  assert.equal(
    next.values.find((cell) => cell.fieldId === targetFields[0]!.id)!.value,
    5,
  );
  assert.equal(
    next.values.find((cell) => cell.fieldId === targetFields[1]!.id)!.value,
    1,
  );
  f.services.inventories.delete(source.id);
  await f.services.attachments!.cleanup();
  for (const file of result.sources)
    assert.equal(
      (await readFile(join(f.directory, `${file.id}.blob`))).length,
      file.byteSize,
    );
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// Empty snapshots still have a preview and create exactly one independent inventory on confirmation.
test("previews and imports an empty inventory with optional metadata overrides", async (context) => {
  const f = await fixture(context);
  const preview = await f.imports.prepare(Readable.from([archive()]));
  assert.deepEqual(
    state(f).map((rows) => rows.length),
    [0, 0, 0, 0, 0, 0],
  );
  assert.equal(preview.status, "ready");
  assert.equal(preview.inventory.description, "Saved description");
  const imported = await f.imports.confirm(preview.id, {});
  assert.equal(imported.description, "Saved description");
  assert.equal(imported.name, "Imported");
  assert.equal((await f.imports.read(preview.id)).inventory_id, imported.id);
  assert.deepEqual(
    state(f).map((rows) => rows.length),
    [1, 0, 0, 0, 0, 0],
  );
});

// Confirmation retries and simultaneous identical requests share one publication and one receipt.
test("makes confirmation idempotent and rejects changed retry parameters", async (context) => {
  const f = await fixture(context);
  const preview = await f.imports.prepare(Readable.from([fileArchive().bytes]));
  const [first, second] = await Promise.all([
    f.imports.confirm(preview.id, { name: "Once" }),
    f.imports.confirm(preview.id, { name: "Once" }),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(
    (await f.imports.confirm(preview.id, { name: "Once" })).id,
    first.id,
  );
  await assert.rejects(
    f.imports.confirm(preview.id, { name: "Different" }),
    (e: unknown) =>
      e instanceof Error &&
      "code" in e &&
      e.code === "inventory_import_conflict",
  );
  assert.equal(f.services.inventories.list().length, 1);
  await f.imports.discard(preview.id);
  assert.equal(f.services.inventories.list().length, 1);
  assert.equal(f.db.select().from(inventoryAttachments).all().length, 1);
});

// A canceled or expired stage cannot later create an inventory, including concurrent discard/confirm calls.
test("cancels and expires previews without publishing data", async (context) => {
  const f = await fixture(context);
  const first = await f.imports.prepare(Readable.from([fileArchive().bytes]));
  await f.imports.discard(first.id);
  await assert.rejects(
    f.imports.confirm(first.id, {}),
    /unavailable or expired/,
  );
  const expired = await f.imports.prepare(Readable.from([fileArchive().bytes]));
  await f.imports.cleanup(Date.now() + importSessionLifetime + 1);
  await assert.rejects(f.imports.read(expired.id), /unavailable or expired/);
  const raced = await f.imports.prepare(Readable.from([fileArchive().bytes]));
  const results = await Promise.allSettled([
    f.imports.discard(raced.id),
    f.imports.confirm(raced.id, {}),
  ]);
  assert.equal(results[0]!.status, "fulfilled");
  assert.equal(results[1]!.status, "rejected");
  assert.deepEqual(
    state(f).map((rows) => rows.length),
    [0, 0, 0, 0, 0, 0],
  );
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// Ordinary item validation is not bypassed for later saves of a grandfathered imported row.
test("retains required-field save validation after historical snapshot import", async (context) => {
  const f = await fixture(context);
  const manifest = fileArchive().manifest;
  manifest.fields[0]!.is_required = true;
  manifest.items = [{ key: "empty", values: [] }];
  manifest.attachments = [];
  const preview = await f.imports.prepare(Readable.from([archive(manifest)]));
  const inventory = await f.imports.confirm(preview.id, {});
  const item = f.services.items.list(inventory.id)[0]!;
  assert.throws(
    () =>
      f.services.items.update(inventory.id, item.id, {
        expected_revision: item.revision,
        values: [],
      }),
    /invalid/i,
  );
});

// Malformed containers/layouts must never be extracted or publish database state.
test("rejects damaged, duplicate, unsafe, symlink, encrypted and unsupported ZIP entries", async (context) => {
  const f = await fixture(context);
  const manifest = {
    name: "inventory.json",
    body: Buffer.from(JSON.stringify(emptyManifest())),
  };
  for (const bytes of [
    Buffer.from("not a ZIP"),
    archive().subarray(0, 40),
    zip([manifest, manifest]),
    ...[
      "../outside",
      "/absolute",
      "C:/drive",
      "attachments/../outside",
      "attachments\\escape",
      "unexpected.txt",
    ].map((name) => zip([manifest, { name, body: Buffer.from("x") }])),
    zip([{ ...manifest, mode: 0o120777 }]),
    zip([{ ...manifest, flags: 0x801 }]),
    zip([{ ...manifest, method: 99 }]),
  ]) {
    await assert.rejects(
      f.imports.prepare(Readable.from([bytes])),
      (e: unknown) =>
        e instanceof Error &&
        "code" in e &&
        e.code === "invalid_inventory_archive",
    );
    assert.equal(f.services.inventories.list().length, 0);
    assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
  }
});

// Invalid text, unknown format versions and inconsistent typed/reference data fail before any publication.
test("rejects invalid manifests and future format versions", async (context) => {
  const f = await fixture(context);
  const invalid = fileArchive().manifest;
  invalid.items[0]!.values[0]!.value = ["unknown-file"];
  for (const bytes of [
    zip([{ name: "inventory.json", body: Buffer.from("{") }]),
    zip([{ name: "inventory.json", body: Buffer.from([0xff, 0xfe]) }]),
    archive({ ...emptyManifest(), unexpected: true }),
    archive(invalid),
  ])
    await assert.rejects(
      f.imports.prepare(Readable.from([bytes])),
      /manifest|JSON/i,
    );
  await assert.rejects(
    f.imports.prepare(
      Readable.from([archive({ ...emptyManifest(), version: 2 })]),
    ),
    (e: unknown) =>
      e instanceof Error &&
      "code" in e &&
      e.code === "unsupported_inventory_archive_version",
  );
  assert.equal(f.services.inventories.list().length, 0);
});

// CRC, actual decompression counts, file checksums and exact manifest membership are independent checks.
test("rejects missing, extra, wrong-size, corrupt-checksum and corrupt-CRC file payloads", async (context) => {
  const f = await fixture(context);
  const { manifest, entries } = fileArchive();
  for (const bytes of [
    archive(manifest),
    archive(manifest, [
      ...entries,
      { name: "attachments/extra", body: Buffer.alloc(0) },
    ]),
    archive(manifest, [
      { name: "attachments/a1", body: Buffer.from("Different!") },
    ]),
    archive(manifest, [{ ...entries[0]!, crc: 123 }]),
    archive(manifest, [{ ...entries[0]!, size: 1 }]),
    zip([
      {
        name: "inventory.json",
        body: Buffer.from(JSON.stringify(emptyManifest())),
        crc: 0,
      },
    ]),
  ])
    await assert.rejects(
      f.imports.prepare(Readable.from([bytes])),
      /size|CRC|SHA|ZIP|match|manifest/i,
    );
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
  assert.equal(f.services.inventories.list().length, 0);
});

// Metadata/resource bounds apply to the manifest and entry count, never to individual attachment bytes.
test("rejects oversized metadata claims without decompressing a huge manifest", async (context) => {
  const f = await fixture(context);
  const bytes = archive();
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(maxManifestBytes + 1, central + 24);
  // Store size validation may reject this even earlier than the metadata bound.
  await assert.rejects(
    f.imports.prepare(Readable.from([bytes])),
    /ZIP|manifest/i,
  );
  assert.ok(maxArchiveEntries > 65_535);
  assert.equal(f.services.inventories.list().length, 0);
});

// A failed late SQLite write must roll back all records and remove only newly prepared managed bytes.
test("rolls back late database failures and allows retrying the same validated stage", async (context) => {
  const f = await fixture(context);
  const preview = await f.imports.prepare(Readable.from([fileArchive().bytes]));
  const before = state(f);
  f.sqlite.exec(
    "CREATE TRIGGER fail_import_file BEFORE INSERT ON inventory_attachments BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
  );
  await assert.rejects(f.imports.confirm(preview.id, {}), /synthetic failure/);
  assert.deepEqual(state(f), before);
  assert.deepEqual(
    (await readdir(f.directory)).filter((name) =>
      /\.(blob|upload)$/.test(name),
    ),
    [],
  );
  assert.equal((await f.imports.read(preview.id)).status, "ready");
  f.sqlite.exec("DROP TRIGGER fail_import_file;");
  const inventory = await f.imports.confirm(preview.id, { name: "Retry" });
  assert.equal(inventory.name, "Retry");
  assert.equal(f.services.inventories.list().length, 1);
});

// Prepared originals are rechecked during publication, not blindly trusted after preview.
test("rejects changed staging bytes, preserves the preview and never creates a partial inventory", async (context) => {
  const f = await fixture(context);
  const preview = await f.imports.prepare(Readable.from([fileArchive().bytes]));
  const work = (await readdir(join(f.directory, ".exchange")))[0]!;
  await writeFile(join(f.directory, ".exchange", work, "file-0"), "Other byte");
  await assert.rejects(f.imports.confirm(preview.id, {}), /checksum/);
  assert.equal((await f.imports.read(preview.id)).status, "ready");
  assert.equal(f.services.inventories.list().length, 0);
  assert.deepEqual(
    (await readdir(f.directory)).filter((name) =>
      /\.(blob|upload)$/.test(name),
    ),
    [],
  );
});

// Invalid destination metadata/group checks do not consume or damage a validated preview.
test("preserves a validated preview after metadata and missing destination-group errors", async (context) => {
  const f = await fixture(context);
  const preview = await f.imports.prepare(Readable.from([fileArchive().bytes]));
  await assert.rejects(f.imports.confirm(preview.id, { name: " " }));
  await assert.rejects(
    f.imports.confirm(preview.id, { group_id: "missing" }),
    /not found/,
  );
  assert.equal(f.services.inventories.list().length, 0);
  assert.deepEqual(
    (await readdir(f.directory)).filter((name) =>
      /\.(blob|upload)$/.test(name),
    ),
    [],
  );
  assert.equal((await f.imports.read(preview.id)).status, "ready");
  await f.imports.confirm(preview.id, { name: "Valid" });
});

// Aborted copies never leave sessions, metadata records or private workspaces.
test("cleans canceled and interrupted archive copies", async (context) => {
  const f = await fixture(context);
  await assert.rejects(
    f.imports.prepare(Readable.from([archive()]), AbortSignal.abort()),
    /abort/i,
  );
  const source = new PassThrough();
  const controller = new AbortController();
  const copying = f.imports.prepare(source, controller.signal);
  source.write(archive().subarray(0, 20));
  controller.abort();
  await assert.rejects(copying, /abort/i);
  assert.equal(f.services.inventories.list().length, 0);
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// Restart loses tokens but leaves only private scratch data, later reconciled without touching unrelated files.
test("reconciles orphan workspaces and expires receipts without deleting imported originals", async (context) => {
  const f = await fixture(context);
  const preview = await f.imports.prepare(Readable.from([fileArchive().bytes]));
  const inventory = await f.imports.confirm(preview.id, {});
  const root = join(f.directory, ".exchange");
  const old = join(root, "import-ABC123");
  await mkdir(old);
  await writeFile(join(old, "partial"), "x");
  await utimes(old, 0, 0);
  const keep = join(root, "keep.txt");
  await writeFile(keep, "Keep");
  const restarted = createServices(f.db, { directory: f.directory });
  await assert.rejects(restarted.imports!.read(preview.id), /expired/);
  await f.imports.cleanup(Date.now() + importSessionLifetime + 1);
  assert.deepEqual(await readdir(root), ["keep.txt"]);
  await assert.rejects(f.imports.confirm(preview.id, {}), /expired/);
  assert.equal(f.services.inventories.get(inventory.id).id, inventory.id);
  const file = f.db.select().from(inventoryAttachments).get()!;
  assert.equal(
    (await readFile(join(f.directory, `${file.id}.blob`))).length,
    file.byteSize,
  );
});

// Public clients use a direct binary body for preview and ordinary JSON only for confirmation.
test("exposes preview, status, confirmation, recovery and cancellation through HTTP", async (context) => {
  const f = await fixture(context);
  const result = await f.api
    .post("/inventory-imports")
    .set("Content-Type", "application/zip")
    .send(fileArchive().bytes)
    .expect(201);
  const preview = result.body;
  assert.equal(preview.field_count, 1);
  assert.equal(preview.item_count, 1);
  assert.equal(preview.path, undefined);
  assert.equal(preview.files, undefined);
  assert.equal(f.services.inventories.list().length, 0);
  await f.api.get(`/inventory-imports/${preview.id}`).expect(200);
  const imported = await f.api
    .post(`/inventory-imports/${preview.id}/confirm`)
    .send({ name: "HTTP copy" })
    .expect(200);
  const retried = await f.api
    .post(`/inventory-imports/${preview.id}/confirm`)
    .send({ name: "HTTP copy" })
    .expect(200);
  assert.equal(retried.body.id, imported.body.id);
  await f.api
    .post(`/inventory-imports/${preview.id}/confirm`)
    .send({ name: "Other" })
    .expect(409);
  assert.equal(f.services.inventories.list().length, 1);
  await f.api.delete(`/inventory-imports/${preview.id}`).expect(204);
  await f.api.get(`/inventory-imports/${preview.id}`).expect(404);
  await f.api.post("/inventory-imports").send({ wrong: true }).expect(415);
  const invalid = await f.api
    .post("/inventory-imports")
    .set("Content-Type", "application/zip")
    .send(Buffer.from("invalid"))
    .expect(422);
  assert.equal(invalid.body.detail.code, "invalid_inventory_archive");
  assert.deepEqual(f.errors, []);
});

// A filesystem error after one successful managed copy still removes all newly prepared originals.
test("cleans earlier copied files after a later staging read fails and permits retry", async (context) => {
  const f = await fixture(context);
  const { manifest, entries } = fileArchive();
  manifest.attachments.push({ ...manifest.attachments[0]!, key: "a2" });
  manifest.items[0]!.values[0]!.value = ["a1", "a2"];
  entries.push({ name: "attachments/a2", body: entries[0]!.body });
  const preview = await f.imports.prepare(
    Readable.from([archive(manifest, entries)]),
  );
  const work = (await readdir(join(f.directory, ".exchange")))[0]!;
  const second = join(f.directory, ".exchange", work, "file-1");
  await rm(second);
  await assert.rejects(f.imports.confirm(preview.id, {}), /ENOENT/);
  assert.equal(f.services.inventories.list().length, 0);
  assert.deepEqual(
    (await readdir(f.directory)).filter((name) =>
      /\.(blob|upload)$/.test(name),
    ),
    [],
  );
  await writeFile(second, entries[0]!.body);
  await f.imports.confirm(preview.id, {});
  assert.equal(f.db.select().from(inventoryAttachments).all().length, 2);
});

// Standard ZIP64 output and an explicit empty attachments directory are both ordinary valid layouts.
test("accepts forced ZIP64 exports and optional empty attachment directory entries", async (context) => {
  const f = await fixture(context);
  const { ZipFile } = await import("yazl");
  const zipfile = new ZipFile();
  zipfile.addBuffer(
    Buffer.from(JSON.stringify(emptyManifest())),
    "inventory.json",
  );
  zipfile.addEmptyDirectory("attachments");
  zipfile.end({ forceZip64Format: true, comment: "" });
  const chunks: Buffer[] = [];
  for await (const chunk of zipfile.outputStream as Readable)
    chunks.push(Buffer.from(chunk));
  const preview = await f.imports.prepare(
    Readable.from([Buffer.concat(chunks)]),
  );
  assert.equal(preview.attachment_count, 0);
  await f.imports.confirm(preview.id, {});
});

// Actual Deflate output is counted while streaming; forged ZIP sizes cannot hide decompression expansion.
test("rejects forged decompression lengths instead of trusting central directory claims", async (context) => {
  const f = await fixture(context);
  const { manifest } = fileArchive();
  const bytes = archive(manifest, [
    {
      name: "attachments/a1",
      body: deflateSync(Buffer.alloc(1024 * 1024, 65)),
      method: 8,
      size: manifest.attachments[0]!.byte_size,
    },
  ]);
  await assert.rejects(
    f.imports.prepare(Readable.from([bytes])),
    (e: unknown) =>
      e instanceof Error &&
      "code" in e &&
      e.code === "invalid_inventory_archive",
  );
  assert.equal(f.services.inventories.list().length, 0);
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// Pending publication outlives disconnects, rejects cancellation and is protected from expiry maintenance.
test("keeps in-progress confirmation protected from discard and expiry", async (context) => {
  const f = await fixture(context);
  const preview = await f.imports.prepare(Readable.from([fileArchive().bytes]));
  const confirming = f.imports.confirm(preview.id, {});
  await Promise.resolve();
  assert.equal((await f.imports.read(preview.id)).status, "importing");
  await assert.rejects(
    f.imports.discard(preview.id),
    /already being confirmed/,
  );
  await f.imports.cleanup(Date.now() + importSessionLifetime + 1);
  const inventory = await confirming;
  assert.equal(f.services.inventories.get(inventory.id).id, inventory.id);
  assert.equal((await f.imports.confirm(preview.id, {})).id, inventory.id);
});

// Reconciliation leases also protect files older than its grace period until import commits or rolls back.
test("protects pending managed copies from orphan cleanup until their import lease is released", async (context) => {
  const f = await fixture(context);
  const id = randomUUID();
  const path = join(f.directory, `${id}.blob`);
  const release = f.services.attachments!.retainPendingFiles([id]);
  await writeFile(path, "Pending");
  await utimes(path, 0, 0);
  await f.services.attachments!.cleanup();
  assert.equal((await readFile(path)).toString(), "Pending");
  release();
  release();
  await f.services.attachments!.cleanup();
  await assert.rejects(readFile(path), /ENOENT/);
});

// A deleted successful result remains a receipt, never permission to create another independent copy.
test("does not recreate an imported inventory after the completed result was deleted", async (context) => {
  const f = await fixture(context);
  const preview = await f.imports.prepare(Readable.from([archive()]));
  const imported = await f.imports.confirm(preview.id, {});
  f.services.inventories.delete(imported.id);
  await assert.rejects(f.imports.confirm(preview.id, {}), /not found/);
  assert.equal(f.services.inventories.list().length, 0);
  assert.equal(f.db.select().from(inventories).all().length, 1);
});

// Refuse impossible aggregate metadata before opening any claimed file streams.
test("rejects unsafe total byte counts before processing attachment payloads", async (context) => {
  const f = await fixture(context);
  const manifest = fileArchive().manifest;
  manifest.attachments[0]!.byte_size = Number.MAX_SAFE_INTEGER;
  manifest.attachments.push({ ...manifest.attachments[0]!, key: "a2" });
  manifest.items[0]!.values[0]!.value = ["a1", "a2"];
  await assert.rejects(
    f.imports.prepare(Readable.from([archive(manifest)])),
    /total attachment size/,
  );
  assert.equal(f.services.inventories.list().length, 0);
});
