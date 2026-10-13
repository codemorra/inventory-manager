import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
