import { Readable } from "node:stream";
import { ZipFile } from "yazl";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";
import { inventories } from "../src/db/schema.js";

// Test that the server serves the health endpoint only after migrations and properly releases resources on shutdown.
test("serves health only after migrations and releases HTTP, database, and log resources on shutdown", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inventory-node-server-"));
  const config = { ...loadConfig({ INVENTORY_DATA_DIR: directory }), port: 0 };
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    runtime = await startServer(config);
    assert.deepEqual(runtime.database.db.select().from(inventories).all(), []);
    await request(runtime.server).get("/health").expect(200, { status: "ok" });
    const preflight = await request(runtime.server)
      .options("/health")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "content-type")
      .expect(200);
    assert.equal(
      preflight.headers["access-control-allow-origin"],
      "http://localhost:5173",
    );
    const denied = await request(runtime.server)
      .get("/health")
      .set("Origin", "https://example.com")
      .expect(200);
    assert.equal(denied.headers["access-control-allow-origin"], undefined);
    await request(runtime.server)
      .post("/health")
      .set("Content-Type", "application/json")
      .send("{")
      .expect(422);
    await request(runtime.server)
      .post("/health")
      .send({ value: "x".repeat(1024 * 1024) })
      .expect(413);
    assert.equal((await stat(config.attachmentsDirectory)).isDirectory(), true);
    await runtime.stop();
    await runtime.stop();
    assert.equal(runtime.server.listening, false);
    assert.equal(runtime.database.sqlite.open, false);
    const log = await readFile(
      join(config.logsDirectory, "inventory-manager.log"),
      "utf8",
    );
    assert.match(log, /Application started/);
    assert.match(log, /Application stopped/);
  } finally {
    await runtime?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

// Test that the server does not start listening when the database cannot be opened and properly logs the startup failure.
test("does not listen when the database cannot be opened, and closes the startup log", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "inventory-node-startup-error-"),
  );
  const config = {
    ...loadConfig({ INVENTORY_DATA_DIR: directory }),
    databasePath: directory,
    port: 0,
  };
  try {
    await assert.rejects(() => startServer(config));
    const log = await readFile(
      join(config.logsDirectory, "inventory-manager.log"),
      "utf8",
    );
    assert.match(log, /Application startup failed/);
    assert.doesNotMatch(log, /Application started/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// Production service composition must send both archive workflows to root-level temp, away from original files.
test("uses the new runtime layout for archive staging and keeps saved data across restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inventory-node-layout-"));
  const config = { ...loadConfig({ INVENTORY_DATA_DIR: directory }), port: 0 };
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    runtime = await startServer(config);
    const api = request(runtime.server);
    const inventory = (
      await api.post("/inventories").send({ name: "Saved" }).expect(201)
    ).body;
    const field = (
      await api
        .post(`/inventories/${inventory.id}/fields`)
        .send({ name: "Files", field_type: "attachment" })
        .expect(201)
    ).body;
    const file = (
      await api
        .post(`/inventories/${inventory.id}/fields/${field.id}/attachments`)
        .set("Content-Type", "application/octet-stream")
        .set("X-File-Name", "file.txt")
        .send(Buffer.from("Saved file"))
        .expect(201)
    ).body;
    await api
      .post(`/inventories/${inventory.id}/items`)
      .send({ values: [{ field_id: field.id, value: [file.id] }] })
      .expect(201);
    const prepared = (
      await api.post(`/inventories/${inventory.id}/exports`).expect(201)
    ).body;
    assert.ok(
      (await readdir(config.tempDirectory)).some((name) =>
        name.startsWith("export-"),
      ),
    );
    assert.deepEqual(await readdir(config.attachmentsDirectory), [
      `${file.id}.blob`,
    ]);
    await api
      .delete(`/inventories/${inventory.id}/exports/${prepared.id}`)
      .expect(204);
    const zip = new ZipFile();
    zip.addBuffer(
      Buffer.from(
        JSON.stringify({
          format: "inventory-manager",
          version: 1,
          inventory: { name: "Preview", description: null },
          fields: [],
          items: [],
          attachments: [],
        }),
      ),
      "inventory.json",
    );
    zip.end();
    const chunks: Buffer[] = [];
    for await (const chunk of zip.outputStream as Readable)
      chunks.push(Buffer.from(chunk));
    const preview = (
      await api
        .post("/inventory-imports")
        .set("Content-Type", "application/zip")
        .send(Buffer.concat(chunks))
        .expect(201)
    ).body;
    assert.ok(
      (await readdir(config.tempDirectory)).some((name) =>
        name.startsWith("import-"),
      ),
    );
    await api.delete(`/inventory-imports/${preview.id}`).expect(204);
    assert.deepEqual(await readdir(config.tempDirectory), []);
    assert.deepEqual(JSON.parse(await readFile(config.settingsPath, "utf8")), {
      version: 1,
    });
    await runtime.stop();
    runtime = await startServer(config);
    const saved = await request(runtime.server).get("/inventories").expect(200);
    assert.equal(saved.body[0].id, inventory.id);
    assert.equal(
      (
        await readFile(join(config.attachmentsDirectory, `${file.id}.blob`))
      ).toString(),
      "Saved file",
    );
  } finally {
    await runtime?.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
