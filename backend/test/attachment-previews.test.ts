import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import test, { type TestContext } from "node:test";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/app.js";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import { inventoryAttachments } from "../src/db/schema.js";
import { queuePreview } from "../src/attachments/preview.js";

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

// Public previews fit the original aspect ratio, strip metadata, and leave original bytes/revisions untouched.
test("serves bounded raster previews without modifying originals, item data, or download behavior", async (context) => {
  const f = await fixture(context);
  const original = await sharp({
    create: {
      width: 800,
      height: 400,
      channels: 4,
      background: { r: 80, g: 20, b: 150, alpha: 0.5 },
    },
  })
    .png()
    .withMetadata()
    .toBuffer();
  const file = await stage(f, original);
  const item = f.services.items.create(f.inventory.id, {
    values: [{ field_id: f.field.id, value: [file.id] }],
  });
  const metadata = f.db.select().from(inventoryAttachments).all();
  const configuration = f.services.inventoryEditor.read(f.inventory.id);
  const result = await f.api.get(`${f.base}/${file.id}/preview`).expect(200);
  assert.equal(result.headers["content-type"], "image/webp");
  assert.match(
    result.headers["content-disposition"]!,
    /^inline;.*preview.webp/,
  );
  assert.equal(result.headers["x-content-type-options"], "nosniff");
  assert.equal(result.headers["cache-control"], "no-store");
  const preview = await sharp(result.body).metadata();
  assert.equal(preview.format, "webp");
  assert.equal(preview.width, 320);
  assert.equal(preview.height, 160);
  assert.equal(preview.exif, undefined);
  assert.equal(preview.icc, undefined);
  assert.equal(preview.hasAlpha, true);
  assert.deepEqual(
    await readFile(join(f.directory, `${file.id}.blob`)),
    original,
  );
  assert.deepEqual(f.db.select().from(inventoryAttachments).all(), metadata);
  assert.deepEqual(f.services.items.read(f.inventory.id, item.id), item);
  assert.deepEqual(
    f.services.inventoryEditor.read(f.inventory.id),
    configuration,
  );
  const download = await f.api.get(`${f.base}/${file.id}/download`).expect(200);
  assert.match(download.headers["content-disposition"]!, /^attachment;/);
  assert.equal(download.headers["content-type"], "application/octet-stream");
  assert.deepEqual(download.body, original);
});

// Supported file bytes, rather than MIME declarations, decide eligibility; small images stay unscaled.
test("supports JPEG, GIF, and WebP bytes and never enlarges small originals", async (context) => {
  const f = await fixture(context);
  for (const format of ["jpeg", "gif", "webp"] as const) {
    const source = await sharp({
      create: { width: 32, height: 16, channels: 3, background: "red" },
    })
      .toFormat(format)
      .toBuffer();
    const file = await stage(f, source, `image.${format}`);
    const result = await f.api.get(`${f.base}/${file.id}/preview`).expect(200);
    const image = await sharp(result.body).metadata();
    assert.equal(image.width, 32);
    assert.equal(image.height, 16);
    assert.equal(image.pages ?? 1, 1);
  }
});

// Camera orientation is applied to the image pixels while private EXIF metadata is removed from the derivative.
test("orients camera photos before fitting the thumbnail", async (context) => {
  const f = await fixture(context);
  const source = await sharp({
    create: { width: 640, height: 320, channels: 3, background: "blue" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const file = await stage(f, source, "camera.jpg");
  const result = await f.api.get(`${f.base}/${file.id}/preview`).expect(200);
  const image = await sharp(result.body).metadata();
  assert.equal(image.width, 120);
  assert.equal(image.height, 240);
  assert.equal(image.orientation, undefined);
});

// Documents and forged/corrupt image data are never embedded as arbitrary original content.
test("rejects unsupported and corrupt originals while keeping them downloadable and the queue usable", async (context) => {
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
  const valid = await stage(
    f,
    await sharp({
      create: { width: 2, height: 2, channels: 3, background: "white" },
    })
      .png()
      .toBuffer(),
  );
  await f.api.get(`${f.base}/${valid.id}/preview`).expect(200);
  assert.deepEqual(f.errors, []);
});

// A queued preview reads its current ownership/lifecycle when it actually runs, rather than retaining stale access.
test("rejects foreign, deleted, and stale queued preview targets", async (context) => {
  const f = await fixture(context);
  const file = await stage(
    f,
    await sharp({
      create: { width: 2, height: 2, channels: 3, background: "red" },
    })
      .png()
      .toBuffer(),
  );
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
  let release!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const blocking = queuePreview(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
        started();
      }),
  );
  await ready;
  const queued = f.services.attachments!.preview(
    f.inventory.id,
    f.field.id,
    file.id,
  );
  f.services.attachments!.discard(f.inventory.id, f.field.id, file.id);
  release();
  await blocking;
  await assert.rejects(queued, /not found/);
  await f.api.get(`${f.base}/${file.id}/preview`).expect(404);
});

// Existing storage verification also protects the inline derivative path from path substitution and missing content.
test("does not preview missing files or substituted symlinks", async (context) => {
  const f = await fixture(context);
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "green" },
  })
    .png()
    .toBuffer();
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
