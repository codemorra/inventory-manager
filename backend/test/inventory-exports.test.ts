import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
  utimes,
  symlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { open as openZip, type ZipFile } from "yauzl";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import {
  inventoryManifestSchema,
  type InventoryManifest,
} from "../src/exchange/manifest.js";
import { archiveFilename } from "../src/exchange/export-service.js";
import { readExportSnapshot } from "../src/exchange/snapshot.js";
import {
  inventoryFields,
  inventoryItems,
  inventoryAttachments,
  inventoryItemValues,
} from "../src/db/schema.js";

/**
 * Use only temporary managed storage and an in-memory migrated database.
 * @param context The test cleanup scope.
 * @returns Domain services, export service, storage and public endpoints.
 */
async function fixture(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "inventory-export-test-"));
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
  const inventory = services.inventories.create({
    name: "Prüfung / Geräte",
    description: "All saved entries",
  });
  return {
    ...connection,
    services,
    exports: services.exports!,
    files: services.attachments!,
    inventory,
    directory,
    api,
    errors,
  };
}

/**
 * Read tiny test archives with an independent ZIP reader, advancing one entry at a time.
 * @param path The completed archive path.
 * @returns Exact uncompressed contents by archive entry name.
 */
async function contents(path: string) {
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    openZip(path, { lazyEntries: true }, (error, file) =>
      error ? reject(error) : resolve(file!),
    ),
  );
  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    const entries = new Map<string, Buffer>();
    zip.on("error", reject);
    zip.on("end", () => resolve(entries));
    zip.on("entry", (entry) => {
      zip.openReadStream(entry, (error, stream) => {
        if (error) {
          zip.close();
          reject(error);
          return;
        }
        void (async () => {
          const chunks: Buffer[] = [];
          for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
          entries.set(entry.fileName, Buffer.concat(chunks));
          zip.readEntry();
        })().catch((error: unknown) => {
          zip.close();
          reject(error);
        });
      });
    });
    zip.readEntry();
  });
}

/**
 * Create a referenced managed file, with an optional zero-byte payload.
 * @param f The isolated fixture.
 * @param body The exact synthetic contents.
 * @returns The attachment field and saved file-owning item.
 */
async function withFile(
  f: Awaited<ReturnType<typeof fixture>>,
  body = "Original bytes",
) {
  const field = f.services.fields.create(f.inventory.id, {
    name: "Files",
    field_type: "attachment",
  });
  const file = await f.files.upload(
    f.inventory.id,
    field.id,
    { filename: "Prüfung.txt", media_type: "text/plain" },
    Readable.from([Buffer.from(body)]),
  );
  const item = f.services.items.create(f.inventory.id, {
    values: [{ field_id: field.id, value: [file.id] }],
  });
  return { field, file, item };
}

// The archive is independent of source UUIDs and contains complete typed structure, values and referenced bytes.
test("exports every field type, option references, automatic counters and Unicode-named managed files", async (context) => {
  const f = await fixture(context);
  const definitions = [
    ["ID", "id", undefined],
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
    f.services.fields.create(f.inventory.id, {
      name,
      field_type,
      ...(field_type === "select" || field_type === "multiselect"
        ? { options: [{ name: "One" }, { name: "Two" }] }
        : {}),
    }),
  );
  const filesField = fields[12]!;
  const first = await f.files.upload(
    f.inventory.id,
    filesField.id,
    { filename: "Prüfung.txt" },
    Readable.from([Buffer.from("One")]),
  );
  const second = await f.files.upload(
    f.inventory.id,
    filesField.id,
    { filename: "Prüfung.txt" },
    Readable.from([Buffer.alloc(0)]),
  );
  await f.files.upload(
    f.inventory.id,
    filesField.id,
    { filename: "UNCLAIMED.txt" },
    Readable.from(["Never export"]),
  );
  const removed = f.services.items.create(f.inventory.id, { values: [] });
  f.services.items.delete(f.inventory.id, removed.id, {
    expected_revision: removed.revision,
  });
  const item = f.services.items.create(f.inventory.id, {
    values: fields.flatMap((field, index) => {
      if (field.fieldType === "id") return [];
      const value =
        field.fieldType === "select"
          ? field.options[0]!.id
          : field.fieldType === "multiselect"
            ? field.options.map((o) => o.id)
            : field.fieldType === "attachment"
              ? [first.id, second.id]
              : definitions[index]![2];
      return [{ field_id: field.id, value }];
    }),
  });
  const before = readExportSnapshot(f.db, f.inventory.id);
  const artifact = await f.exports.create(f.inventory.id);
  const entries = await contents(artifact.path);
  const manifest = inventoryManifestSchema.parse(
    JSON.parse(entries.get("inventory.json")!.toString()),
  );
  assert.equal(manifest.fields.length, 13);
  assert.equal(manifest.items.length, 1);
  assert.equal(manifest.fields[0]!.last_assigned_id, 2);
  assert.equal(
    manifest.items[0]!.values.find((v) => v.field === manifest.fields[0]!.key)!
      .value,
    2,
  );
  assert.deepEqual(manifest.inventory, {
    name: f.inventory.name,
    description: f.inventory.description,
  });
  assert.equal(manifest.attachments.length, 2);
  assert.deepEqual(
    manifest.attachments.map((file) => file.filename),
    ["Prüfung.txt", "Prüfung.txt"],
  );
  for (const file of manifest.attachments) {
    const bytes = entries.get(`attachments/${file.key}`)!;
    assert.equal(bytes.length, file.byte_size);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), file.sha256);
  }
  assert.equal(entries.size, 3);
  const json = entries.get("inventory.json")!.toString();
  for (const id of [
    f.inventory.id,
    item.id,
    ...fields.map((field) => field.id),
    first.id,
    second.id,
  ])
    assert.ok(!json.includes(id));
  assert.ok(!json.includes("UNCLAIMED"));
  assert.equal(
    readExportSnapshot(f.db, f.inventory.id).fingerprint,
    before.fingerprint,
  );
  assert.deepEqual(
    await readFile(join(f.directory, `${first.id}.blob`)),
    Buffer.from("One"),
  );
  await artifact.dispose();
  await artifact.dispose();
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// Snapshot validation deliberately preserves legitimate saved history rather than applying create-item rules.
test("preserves missing later-required fields, unavailable option references and duplicate option names", async (context) => {
  const f = await fixture(context);
  const selection = f.services.fields.create(f.inventory.id, {
    name: "Choice",
    field_type: "multiselect",
    options: [{ name: "Removed" }, { name: "Kept" }, { name: "Other" }],
  });
  f.services.items.create(f.inventory.id, {
    values: [
      { field_id: selection.id, value: selection.options.map((o) => o.id) },
    ],
  });
  f.services.options.delete(
    f.inventory.id,
    selection.id,
    selection.options[0]!.id,
  );
  f.services.options.update(
    f.inventory.id,
    selection.id,
    selection.options[2]!.id,
    { name: "Kept" },
  );
  const required = f.services.fields.create(f.inventory.id, {
    name: "New required",
    field_type: "text",
    is_required: true,
  });
  const artifact = await f.exports.create(f.inventory.id);
  const manifest = JSON.parse(
    (await contents(artifact.path)).get("inventory.json")!.toString(),
  ) as InventoryManifest;
  assert.ok(inventoryManifestSchema.safeParse(manifest).success);
  assert.deepEqual(
    manifest.fields[0]!.options.map(({ available, name }) => ({
      available,
      name,
    })),
    [
      { available: false, name: null },
      { available: true, name: "Kept" },
      { available: true, name: "Kept" },
    ],
  );
  assert.ok(!JSON.stringify(manifest).includes("Removed"));
  const newField = manifest.fields.find(
    (field) => field.name === required.name,
  )!;
  assert.equal(newField.is_required, true);
  assert.ok(!manifest.items[0]!.values.some((v) => v.field === newField.key));
  await artifact.dispose();
});

// An empty inventory still exports an ordinary readable ZIP with an explicitly versioned manifest.
test("exports empty inventories and rejects malformed portable schemas", async (context) => {
  const f = await fixture(context);
  const artifact = await f.exports.create(f.inventory.id);
  const entries = await contents(artifact.path);
  assert.deepEqual([...entries.keys()], ["inventory.json"]);
  const manifest = JSON.parse(
    entries.get("inventory.json")!.toString(),
  ) as InventoryManifest;
  assert.equal(manifest.format, "inventory-manager");
  assert.equal(manifest.version, 1);
  for (const changed of [
    { ...manifest, version: 2 },
    { ...manifest, surprise: true },
    {
      ...manifest,
      inventory: { ...manifest.inventory, group_id: "source-group" },
    },
  ])
    assert.equal(inventoryManifestSchema.safeParse(changed).success, false);
  await artifact.dispose();
});

// A file with matching length but changed contents must not be offered as a valid export.
test("rejects corrupt original bytes and clears partial archive storage", async (context) => {
  const f = await fixture(context);
  const { file } = await withFile(f);
  await writeFile(join(f.directory, `${file.id}.blob`), "Different byte");
  await assert.rejects(f.exports.create(f.inventory.id), /checksum/);
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// Existing managed reads enforce active scope and reject missing or substituted files.
test("rejects missing and symlink-substituted originals without leaving exports", async (context) => {
  const f = await fixture(context);
  const { file } = await withFile(f);
  const path = join(f.directory, `${file.id}.blob`);
  await rm(path);
  await assert.rejects(f.exports.create(f.inventory.id), /not found/);
  const unrelated = join(f.directory, "private.txt");
  await writeFile(unrelated, "Original bytes");
  await symlink(unrelated, path);
  await assert.rejects(f.exports.create(f.inventory.id));
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// A concurrent saved edit invalidates the completed artifact rather than mixing old metadata with new content.
test("detects concurrent item edits and cleans the rejected archive", async (context) => {
  const f = await fixture(context);
  const { item } = await withFile(f);
  const original = f.files.download;
  f.files.download = async (...args) => {
    const file = await original(...args);
    f.db
      .update(inventoryItems)
      .set({ revision: item.revision + 1 })
      .where(eq(inventoryItems.id, item.id))
      .run();
    return file;
  };
  await assert.rejects(
    f.exports.create(f.inventory.id),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "inventory_export_conflict",
  );
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// Disconnected clients stop streaming and remove all partially created artifacts.
test("honors cancellation before and during file reads", async (context) => {
  const f = await fixture(context);
  await withFile(f);
  await assert.rejects(
    f.exports.create(f.inventory.id, AbortSignal.abort()),
    /abort/i,
  );
  const controller = new AbortController();
  const original = f.files.download;
  f.files.download = async (...args) => {
    const file = await original(...args);
    controller.abort();
    return file;
  };
  await assert.rejects(
    f.exports.create(f.inventory.id, controller.signal),
    /abort/i,
  );
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// Export read-only behavior includes failures and the HTTP route, which only sends a completed archive.
test("serves ZIP download headers, sanitizes filenames and cleans storage after response", async (context) => {
  const f = await fixture(context);
  const { item } = await withFile(f);
  const before = f.services.items.read(f.inventory.id, item.id);
  const prepared = await f.api
    .post(`/inventories/${f.inventory.id}/exports`)
    .expect(201);
  assert.equal(prepared.body.filename, "Prüfung _ Geräte.zip");
  assert.equal(prepared.body.path, undefined);
  const downloadPath = `/inventories/${f.inventory.id}/exports/${prepared.body.id}/download`;
  const result = await f.api.get(downloadPath).expect(200);
  await f.api.get(downloadPath).expect(404);
  assert.equal(result.headers["content-type"], "application/zip");
  assert.match(result.headers["content-disposition"]!, /^attachment;/);
  assert.ok(!result.headers["content-disposition"]!.includes(" / "));
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["x-content-type-options"], "nosniff");
  assert.ok(Number(result.headers["content-length"]) > 100);
  // HTTP completion precedes the async finally cleanup; wait without a timing-dependent sleep.
  for (
    let attempt = 0;
    attempt < 100 && (await readdir(join(f.directory, ".exchange"))).length;
    attempt++
  )
    await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
  assert.deepEqual(f.services.items.read(f.inventory.id, item.id), before);
  assert.deepEqual(f.errors, []);
  await f.api.post("/inventories/missing/exports").expect(404);
  assert.equal(archiveFilename("../CON"), "_CON.zip");
  assert.equal(archiveFilename("CON"), "_CON.zip");
  assert.equal(archiveFilename("..."), "inventory.zip");
});

// Stale crash artifacts are swept without touching current exports or unrelated application files.
test("reconciles old scratch directories while preserving active artifacts and unrelated files", async (context) => {
  const f = await fixture(context);
  const artifact = await f.exports.create(f.inventory.id);
  const root = join(f.directory, ".exchange");
  const old = join(root, "export-ABC123");
  await mkdir(old);
  await writeFile(join(old, "inventory.zip"), "Partial");
  const unrelated = join(root, "keep.txt");
  await writeFile(unrelated, "Keep");
  const future = Date.now() + 48 * 60 * 60 * 1000;
  await utimes(old, 0, 0);
  await f.exports.cleanup(future);
  assert.deepEqual(
    (await readdir(root)).sort(),
    [basename(dirname(artifact.path)), "keep.txt"].sort(),
  );
  assert.ok((await readFile(artifact.path)).length);
  await artifact.dispose();
});

// Corrupt references must never be silently normalized into a seemingly successful transfer.
test("rejects inconsistent stored references and malformed attachment ownership", async (context) => {
  const f = await fixture(context);
  const { file, field } = await withFile(f);
  f.db
    .update(inventoryAttachments)
    .set({ itemId: null })
    .where(eq(inventoryAttachments.id, file.id))
    .run();
  await assert.rejects(f.exports.create(f.inventory.id), /inconsistent/);
  f.db
    .update(inventoryItemValues)
    .set({ value: ["missing"] })
    .where(eq(inventoryItemValues.fieldId, field.id))
    .run();
  await assert.rejects(f.exports.create(f.inventory.id), /inconsistent/);
});

// Schema-level integrity rules protect the future import path, beyond JSON structural types.
test("validates automatic numbers, counters, field settings, references and file scope", async (context) => {
  const f = await fixture(context);
  const id = f.services.fields.create(f.inventory.id, {
    name: "ID",
    field_type: "id",
  });
  const { file } = await withFile(f);
  const artifact = await f.exports.create(f.inventory.id);
  const original = JSON.parse(
    (await contents(artifact.path)).get("inventory.json")!.toString(),
  ) as InventoryManifest;
  const reject = (change: (manifest: InventoryManifest) => void) => {
    const manifest = structuredClone(original);
    change(manifest);
    assert.equal(inventoryManifestSchema.safeParse(manifest).success, false);
  };
  reject((m) => {
    m.fields[0]!.last_assigned_id = 0;
  });
  reject((m) => {
    m.items[0]!.values.find((v) => v.field === m.fields[0]!.key)!.value = -1;
  });
  reject((m) => {
    m.items.push(structuredClone(m.items[0]!));
    m.items[1]!.key = "another";
  });
  reject((m) => {
    m.attachments[0]!.item = "wrong";
  });
  reject((m) => {
    m.attachments[0]!.sha256 = "bad";
  });
  reject((m) => {
    m.items[0]!.values.push({ field: "unknown", value: false });
  });
  reject((m) => {
    m.items[0]!.values.push(structuredClone(m.items[0]!.values[0]!));
  });
  reject((m) => {
    m.fields[1]!.max_length = 10;
  });
  reject((m) => {
    m.attachments[0]!.filename = "../unsafe";
  });
  assert.equal(original.fields[0]!.last_assigned_id, 1);
  assert.ok(!JSON.stringify(original).includes(id.id));
  assert.ok(!JSON.stringify(original).includes(file.id));
  // A corrupt stored counter also prevents export, without resetting the source.
  f.db
    .update(inventoryFields)
    .set({ lastAssignedId: 0 })
    .where(eq(inventoryFields.id, id.id))
    .run();
  await assert.rejects(f.exports.create(f.inventory.id), /inconsistent/);
  await artifact.dispose();
});

// Prepared tokens are scoped, single-use, expiring and cancelable without leaking managed scratch paths.
test("scopes prepared exports and supports expiry, cancellation and non-consuming HEAD probes", async (context) => {
  const f = await fixture(context);
  const other = f.services.inventories.create({ name: "Other" });
  const path = `/inventories/${f.inventory.id}/exports`;
  const prepared = await f.api.post(path).expect(201);
  await f.api
    .get(`/inventories/${other.id}/exports/${prepared.body.id}/download`)
    .expect(404);
  await f.api.head(`${path}/${prepared.body.id}/download`).expect(405);
  await f.api.delete(`${path}/${prepared.body.id}`).expect(204);
  await f.api.get(`${path}/${prepared.body.id}/download`).expect(404);
  const expired = await f.api.post(path).expect(201);
  await f.exports.cleanup(Date.now() + 16 * 60 * 1000);
  await f.api.get(`${path}/${expired.body.id}/download`).expect(404);
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// Once a source inventory has been deleted, old prepared downloads no longer expose its copied data.
test("rejects prepared exports after source deletion and removes their artifacts", async (context) => {
  const f = await fixture(context);
  await withFile(f);
  const prepared = await f.exports.prepare(f.inventory.id);
  f.services.inventories.delete(f.inventory.id);
  await assert.rejects(
    f.exports.take(f.inventory.id, prepared.id),
    /not found/,
  );
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// Structured preparation errors let the future interface explain failure before triggering a native download.
test("returns structured checksum failures and preserves unrelated inventory activity", async (context) => {
  const f = await fixture(context);
  const { file } = await withFile(f);
  const original = f.files.download;
  f.files.download = async (...args) => {
    const stream = await original(...args);
    f.services.inventories.create({ name: "Unrelated write" });
    return stream;
  };
  const prepared = await f.api
    .post(`/inventories/${f.inventory.id}/exports`)
    .expect(201);
  await f.api
    .delete(`/inventories/${f.inventory.id}/exports/${prepared.body.id}`)
    .expect(204);
  await writeFile(join(f.directory, `${file.id}.blob`), "Different byte");
  const failed = await f.api
    .post(`/inventories/${f.inventory.id}/exports`)
    .expect(422);
  assert.equal(failed.body.detail.code, "inventory_export_unavailable");
  assert.deepEqual(f.errors, []);
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// Tables flatten every non-file type without accessing excluded managed originals or mutating saved data.
test("exports readable CSV and Markdown values in saved field order without attachments", async (context) => {
  const f = await fixture(context);
  const definitions = [
    ["ID", "id", undefined],
    ["Text", "text", 'Prüfung, "quoted" | <script> & *text*\\\nnext'],
    ["Number", "number", 0],
    ["Boolean", "boolean", false],
    ["Checkbox", "checkbox", true],
    ["Date", "date", "2026-10-27"],
    ["Time", "time", "12:34"],
    ["Datetime", "datetime", "2026-10-27T12:34"],
    ["Duration", "duration", 61],
    ["Link", "url", { url: "https://example.com", label: "Example" }],
    ["Bare link", "url", { url: "https://example.org" }],
    ["Select", "select", undefined],
    ["Multiselect", "multiselect", undefined],
    ["Missing", "text", undefined],
  ] as const;
  const fields = definitions.map(([name, field_type]) =>
    f.services.fields.create(f.inventory.id, {
      name,
      field_type,
      ...(field_type === "select" || field_type === "multiselect"
        ? { options: [{ name: "One" }, { name: "Two" }] }
        : {}),
    }),
  );
  const { file, item } = await withFile(f);
  // Excluded files must not make a table depend on the availability of attachment bytes.
  await rm(join(f.directory, `${file.id}.blob`));
  const saved = f.services.items.update(f.inventory.id, item.id, {
    expected_revision: item.revision,
    values: [
      ...item.values
        .filter((value) => value.fieldId !== fields[0]!.id)
        .map((value) => ({
          field_id: value.fieldId,
          value: value.value,
        })),
      ...fields.flatMap((field, index) => {
        if (field.fieldType === "id" || field.name === "Missing") return [];
        const value =
          field.fieldType === "select"
            ? field.options[0]!.id
            : field.fieldType === "multiselect"
              ? field.options.map((option) => option.id)
              : definitions[index]![2];
        return [{ field_id: field.id, value }];
      }),
    ],
  });
  const before = f.services.items.read(f.inventory.id, saved.id);
  const csv = await f.exports.createTable(f.inventory.id, "csv");
  assert.equal(csv.filename, "Prüfung _ Geräte.csv");
  assert.equal(csv.omittedAttachmentFields, 1);
  const csvText = await readFile(csv.path, "utf8");
  assert.equal(csv.byteSize, Buffer.byteLength(csvText));
  assert.equal(
    csvText,
    '"ID","Text","Number","Boolean","Checkbox","Date","Time","Datetime","Duration","Link","Bare link","Select","Multiselect","Missing"\r\n' +
      '"1","Prüfung, ""quoted"" | <script> & *text*\\\nnext","0","false","true","2026-10-27","12:34","2026-10-27T12:34","61","Example (https://example.com)","https://example.org","One","One; Two",""\r\n',
  );
  const markdown = await f.exports.createTable(f.inventory.id, "markdown");
  assert.equal(markdown.filename, "Prüfung _ Geräte.md");
  const markdownText = await readFile(markdown.path, "utf8");
  assert.deepEqual(
    markdownText
      .split("\n")[0]!
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
    fields.map((field) => field.name),
  );
  assert.match(markdownText.split("\n")[1]!, /^\| (?:-{3,} \| )*-{3,} \|$/);
  assert.ok(
    markdownText.includes(
      'Prüfung, "quoted" \\| &lt;script&gt; &amp; \\*text\\*\\\\<br>next',
    ),
  );
  assert.match(markdownText, /\| 0 +\| false +\| true +\|/);
  assert.match(markdownText, /\| One +\| One; Two +\| +\|/);
  assert.ok(!markdownText.includes("Files"));
  assert.deepEqual(f.services.items.read(f.inventory.id, saved.id), before);
  await csv.dispose();
  await markdown.dispose();
});

// Header escaping and historical empty or deleted selection values remain readable in both encodings.
test("escapes table headers and preserves row order, missing values and unavailable options", async (context) => {
  const f = await fixture(context);
  const field = f.services.fields.create(f.inventory.id, {
    name: 'Choice | "name"',
    field_type: "select",
    options: [{ name: "Removed" }],
  });
  const first = f.services.items.create(f.inventory.id, {
    values: [{ field_id: field.id, value: field.options[0]!.id }],
  });
  const second = f.services.items.create(f.inventory.id, { values: [] });
  f.db
    .update(inventoryItems)
    .set({ createdAt: "2026-01-01T00:00:00.000Z" })
    .where(eq(inventoryItems.id, first.id))
    .run();
  f.db
    .update(inventoryItems)
    .set({ createdAt: "2026-01-02T00:00:00.000Z" })
    .where(eq(inventoryItems.id, second.id))
    .run();
  f.services.options.delete(f.inventory.id, field.id, field.options[0]!.id);
  const csv = await f.exports.createTable(f.inventory.id, "csv");
  assert.equal(
    await readFile(csv.path, "utf8"),
    '"Choice | ""name"""\r\n""\r\n"[unavailable]"\r\n',
  );
  const markdown = await f.exports.createTable(f.inventory.id, "markdown");
  assert.equal(
    await readFile(markdown.path, "utf8"),
    '| Choice \\| "name" |\n| ---------------- |\n|                  |\n| \\[unavailable\\]  |\n',
  );
  await csv.dispose();
  await markdown.dispose();
});

// Empty schemas cannot form useful tables, while fields with no items still provide a valid header.
test("requires a non-attachment table column and exports headers for inventories without items", async (context) => {
  const f = await fixture(context);
  await assert.rejects(
    f.exports.createTable(f.inventory.id, "csv"),
    /at least one field/,
  );
  f.services.fields.create(f.inventory.id, {
    name: "Files",
    field_type: "attachment",
  });
  await assert.rejects(
    f.exports.createTable(f.inventory.id, "markdown"),
    /at least one field/,
  );
  f.services.fields.create(f.inventory.id, {
    name: "Text",
    field_type: "text",
  });
  for (const format of ["csv", "markdown"] as const) {
    await assert.rejects(
      f.exports.createTable(f.inventory.id, format, AbortSignal.abort()),
      /abort/i,
    );
    const artifact = await f.exports.createTable(f.inventory.id, format);
    assert.equal(
      await readFile(artifact.path, "utf8"),
      format === "csv" ? '"Text"\r\n' : "| Text |\n| ---- |\n",
    );
    await artifact.dispose();
  }
  assert.deepEqual(await readdir(join(f.directory, ".exchange")), []);
});

// New formats share inventory-scoped, single-use downloads and cancellation with existing ZIP exports.
test("serves table media types and validates format requests before preparing exports", async (context) => {
  const f = await fixture(context);
  f.services.fields.create(f.inventory.id, {
    name: "Text",
    field_type: "text",
  });
  f.services.fields.create(f.inventory.id, {
    name: "Files",
    field_type: "attachment",
  });
  const path = `/inventories/${f.inventory.id}/exports`;
  for (const body of [
    { format: "pdf" },
    { format: null },
    { format: "csv", extra: true },
    [],
  ])
    await f.api.post(path).send(body).expect(422);
  const other = f.services.inventories.create({ name: "Other" });
  for (const format of ["csv", "markdown"] as const) {
    const prepared = await f.api.post(path).send({ format }).expect(201);
    assert.equal(prepared.body.omitted_attachment_fields, 1);
    assert.equal(prepared.body.path, undefined);
    const download = `${path}/${prepared.body.id}/download`;
    await f.api
      .get(`/inventories/${other.id}/exports/${prepared.body.id}/download`)
      .expect(404);
    await f.api.head(download).expect(405);
    const result = await f.api.get(download).expect(200);
    assert.match(
      result.headers["content-type"]!,
      format === "csv"
        ? /^text\/csv; charset=utf-8$/
        : /^text\/markdown; charset=utf-8$/,
    );
    assert.equal(
      result.text,
      format === "csv" ? '"Text"\r\n' : "| Text |\n| ---- |\n",
    );
    assert.equal(
      Number(result.headers["content-length"]),
      Buffer.byteLength(result.text),
    );
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    assert.match(result.headers["content-disposition"]!, /attachment;/);
    await f.api.get(download).expect(404);
    const canceled = await f.api.post(path).send({ format }).expect(201);
    await f.api.delete(`${path}/${canceled.body.id}`).expect(204);
    await f.api.get(`${path}/${canceled.body.id}/download`).expect(404);
    const expired = await f.api.post(path).send({ format }).expect(201);
    await f.exports.cleanup(Date.now() + 16 * 60 * 1000);
    await f.api.get(`${path}/${expired.body.id}/download`).expect(404);
  }
  assert.deepEqual(f.errors, []);
});

// Escaped headers and values determine source widths; short and empty cells keep every column aligned.
test("aligns Markdown columns to the longest escaped header or value with at least three dashes", async (context) => {
  const f = await fixture(context);
  const cable = f.services.fields.create(f.inventory.id, {
    name: "Cable",
    field_type: "text",
  });
  const length = f.services.fields.create(f.inventory.id, {
    name: "Length (m)",
    field_type: "number",
  });
  f.services.fields.create(f.inventory.id, { name: "X", field_type: "text" });
  f.services.items.create(f.inventory.id, {
    values: [
      { field_id: cable.id, value: "DisplayPort to DisplayPort" },
      { field_id: length.id, value: 1.5 },
    ],
  });
  const artifact = await f.exports.createTable(f.inventory.id, "markdown");
  assert.equal(
    await readFile(artifact.path, "utf8"),
    "| Cable                      | Length \\(m\\) | X   |\n" +
      "| -------------------------- | ------------ | --- |\n" +
      "| DisplayPort to DisplayPort | 1.5          |     |\n",
  );
  await artifact.dispose();
});
