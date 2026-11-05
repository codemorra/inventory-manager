import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import { inventoryAttachments } from "../src/db/schema.js";
import { maxPreviewBytes } from "../src/attachments/preview.js";

/**
 * Create real isolated managed storage and a preview-capable HTTP app.
 * @param context The test cleanup scope.
 * @returns Public endpoints, domain services, and temporary storage.
 */
async function fixture(context: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "inventory-image-previews-"));
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
  const inventory = services.inventories.create({ name: "Photos" });
  const field = services.fields.create(inventory.id, {
    name: "Files",
    field_type: "attachment",
  });
  context.after(async () => {
    try {
      await services.attachments!.cleanup();
    } finally {
      connection.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
  return {
    ...connection,
    services,
    directory,
    inventory,
    field,
    api,
    errors,
    base: `/inventories/${inventory.id}/fields/${field.id}/attachments`,
  };
}

/**
 * Store synthetic bytes with an intentionally unhelpful declared MIME type.
 * @param f The isolated managed storage fixture.
 * @param content The exact original bytes.
 * @param filename The display filename.
 * @returns The completed staged copy.
 */
async function stage(
  f: Awaited<ReturnType<typeof fixture>>,
  content: Buffer,
  filename = "photo.png",
) {
  return f.services.attachments!.upload(
    f.inventory.id,
    f.field.id,
    { filename, media_type: "application/octet-stream" },
    Readable.from([content]),
  );
}

// Fixtures are synthetic 32 × 16 rasters generated once, independent of the runtime header inspector.
async function image(format = "png") {
  return readFile(
    new URL(`./fixtures/preview/image.${format}`, import.meta.url),
  );
}

test("streams exact original bytes with signature-derived types and safe headers for all supported formats", async (context) => {
  const f = await fixture(context);
  for (const format of ["png", "jpeg", "gif", "webp"]) {
    const original = await image(format);
    const file = await stage(f, original, "misleading.html");
    const item = f.services.items.create(f.inventory.id, {
      values: [{ field_id: f.field.id, value: [file.id] }],
    });
    const metadata = f.db.select().from(inventoryAttachments).all();
    const result = await f.api.get(`${f.base}/${file.id}/preview`).expect(200);
    assert.equal(result.headers["content-type"], `image/${format}`);
    assert.equal(result.headers["content-length"], String(original.length));
    assert.match(result.headers["content-disposition"]!, /^inline;/);
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    assert.equal(result.headers["cache-control"], "no-store");
    assert.equal(
      result.headers["content-security-policy"],
      "default-src 'none'; sandbox",
    );
    assert.deepEqual(result.body, original);
    assert.deepEqual(
      await readFile(join(f.directory, `${file.id}.blob`)),
      original,
    );
    assert.deepEqual(f.db.select().from(inventoryAttachments).all(), metadata);
    assert.deepEqual(f.services.items.read(f.inventory.id, item.id), item);
    const download = await f.api
      .get(`${f.base}/${file.id}/download`)
      .expect(200);
    assert.match(download.headers["content-disposition"]!, /^attachment;/);
    assert.equal(download.headers["content-type"], "application/octet-stream");
    assert.deepEqual(download.body, original);
  }
});

// Documents and forged/corrupt image data are never embedded as arbitrary original content.
test("rejects unsupported and corrupt originals while keeping them downloadable", async (context) => {
  const f = await fixture(context);
  for (const content of [
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ),
    Buffer.from("%PDF-1.7 document"),
    Buffer.from("<html>document</html>"),
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
  ]) {
    const file = await stage(f, content, "forged.png");
    const result = await f.api.get(`${f.base}/${file.id}/preview`).expect(415);
    assert.equal(result.body.detail.code, "attachment_preview_unavailable");
    const download = await f.api
      .get(`${f.base}/${file.id}/download`)
      .expect(200);
    assert.deepEqual(download.body, content);
  }
  const valid = await stage(f, await image());
  await f.api.get(`${f.base}/${valid.id}/preview`).expect(200);
  assert.deepEqual(f.errors, []);
});

test("rejects foreign, deleted, and missing preview targets", async (context) => {
  const f = await fixture(context);
  const file = await stage(f, await image());
  const other = f.services.inventories.create({ name: "Other" });
  const field = f.services.fields.create(other.id, {
    name: "Files",
    field_type: "attachment",
  });
  await f.api
    .get(
      `/inventories/${other.id}/fields/${field.id}/attachments/${file.id}/preview`,
    )
    .expect(404);
  await f.api.get(`${f.base}/missing/preview`).expect(404);
  const pending = f.services.attachments!.preview(
    f.inventory.id,
    f.field.id,
    file.id,
  );
  f.services.attachments!.discard(f.inventory.id, f.field.id, file.id);
  await assert.rejects(pending, /not found/);
  await f.api.get(`${f.base}/${file.id}/preview`).expect(404);
});

test("rejects oversized bytes and dimensions before loading an original", async (context) => {
  const f = await fixture(context);
  const huge = Buffer.alloc(maxPreviewBytes + 1);
  const file = await stage(f, huge);
  await f.api.get(`${f.base}/${file.id}/preview`).expect(415);
  const dimensions = await image();
  dimensions.writeUInt32BE(100_000, 16);
  const large = await stage(f, dimensions);
  await f.api.get(`${f.base}/${large.id}/preview`).expect(415);
  const mismatch = await stage(f, await image());
  await writeFile(join(f.directory, `${mismatch.id}.blob`), "changed");
  await f.api.get(`${f.base}/${mismatch.id}/preview`).expect(415);
});

// Existing storage verification also protects the inline derivative path from path substitution and missing content.
test("does not preview missing files or substituted symlinks", async (context) => {
  const f = await fixture(context);
  const bytes = await image();
  const file = await stage(f, bytes);
  const path = join(f.directory, `${file.id}.blob`);
  await rm(path);
  await f.api.get(`${f.base}/${file.id}/preview`).expect(404);
  const privatePath = join(f.directory, "unmanaged.png");
  await writeFile(privatePath, bytes);
  await symlink(privatePath, path);
  await f.api
    .get(`${f.base}/${file.id}/preview`)
    .expect(500, { detail: "Internal Server Error" });
});

// A disconnected client owns only a stream; destroying it must close the verified descriptor.
test("closes the managed file stream when its consumer aborts", async (context) => {
  const f = await fixture(context);
  const file = await stage(f, await image());
  const result = await f.services.attachments!.preview(
    f.inventory.id,
    f.field.id,
    file.id,
  );
  const done = finished(result.stream);
  result.stream.destroy(new Error("Consumer disconnected"));
  await assert.rejects(done, /Consumer disconnected/);
  assert.equal(result.stream.closed, true);
});
