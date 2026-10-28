import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test, { type TestContext } from "node:test";
import request, { type Response } from "supertest";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";
import { initializeStorage } from "../src/storage.js";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import { createBackup } from "../src/backups/service.js";
import { inspectRestoreDatabase } from "../src/backups/restore-database.js";
import { verifyBackup } from "../src/backups/archive.js";
import {
  commitRestore,
  publishRestore,
  readRestoreReceipt,
  recoverRestore,
  restoreContainers,
  stageRestore,
} from "../src/backups/restore-storage.js";

/**
 * Collect only tiny synthetic ZIP responses for HTTP round-trip assertions.
 * @param response The test download response.
 * @param done Report the completed buffer or a stream error.
 * @returns No value; completion is delivered through the parser callback.
 */
function binaryBody(
  response: Response,
  done: (error: Error | null, body?: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(chunk));
  response.once("end", () => done(null, Buffer.concat(chunks)));
  response.once("error", done);
}

/**
 * Start an isolated runtime and seed one inventory with a saved managed attachment.
 * @param context The test cleanup scope.
 * @returns The runtime, API client and saved fixture identities.
 */
async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "inventory-restore-runtime-"));
  const runtime = await startServer({
    ...loadConfig({ INVENTORY_DATA_DIR: root }),
    port: 0,
  });
  context.after(async () => {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  });
  const api = request(runtime.server);
  const inventory = (
    await api.post("/inventories").send({ name: "Original" }).expect(201)
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
      .set("X-File-Name", "saved.txt")
      .send(Buffer.from("saved original"))
      .expect(201)
  ).body;
  await api
    .post(`/inventories/${inventory.id}/items`)
    .send({ values: [{ field_id: field.id, value: [file.id] }] })
    .expect(201);
  const backup = (await api.post("/backups").expect(201)).body;
  return { root, runtime, api, inventory, field, file, backup };
}

test("previews stored backups, preserves a safety copy, restores data and invalidates stale writes and exchange sessions", async (context) => {
  const f = await fixture(context);
  const oldGeneration = (await f.api.get("/health")).headers[
    "x-inventory-generation"
  ]!;
  const firstExport = (
    await f.api.post(`/inventories/${f.inventory.id}/exports`).expect(201)
  ).body;
  const exported = (
    await f.api
      .get(`/inventories/${f.inventory.id}/exports/${firstExport.id}/download`)
      .buffer(true)
      .parse(binaryBody)
      .expect(200)
  ).body as Buffer;
  const staleExport = (
    await f.api.post(`/inventories/${f.inventory.id}/exports`).expect(201)
  ).body;
  const staleImport = (
    await f.api
      .post("/inventory-imports")
      .set("Content-Type", "application/zip")
      .send(exported)
      .expect(201)
  ).body;
  const added = (
    await f.api.post("/inventories").send({ name: "Later" }).expect(201)
  ).body;
  await f.api
    .patch("/application-settings")
    .send({ expected_revision: 0, preferences: { theme: "dark" } })
    .expect(200);
  const settings = await readFile(f.runtime.config.settingsPath);
  const preview = (
    await f.api
      .post("/backup-restores")
      .send({ filename: f.backup.filename })
      .expect(201)
  ).body;
  assert.equal(preview.status, "ready");
  assert.deepEqual(preview.counts, {
    inventories: 1,
    items: 1,
    attachments: 1,
  });
  assert.equal((await f.api.get("/inventories")).body.length, 2);
  // The checked preview owns its archive copy even after the original backup is removed.
  await f.api.delete(`/backups/${f.backup.filename}`).expect(204);
  const result = await f.api
    .post(`/backup-restores/${preview.id}/confirm`)
    .set("X-Inventory-Generation", oldGeneration)
    .expect(200);
  assert.equal(result.body.backup_id, f.backup.id);
  const current = await f.api.get("/inventories").expect(200);
  assert.deepEqual(
    current.body.map((entry: { id: string }) => entry.id),
    [f.inventory.id],
  );
  const generation = current.headers["x-inventory-generation"]!;
  assert.notEqual(generation, oldGeneration);
  await f.api
    .post("/inventories")
    .set("X-Inventory-Generation", oldGeneration)
    .send({ name: "Stale" })
    .expect(409);
  await f.api
    .post("/inventories")
    .set("X-Inventory-Generation", generation)
    .send({ name: "Fresh" })
    .expect(201);
  await f.api
    .get(`/inventories/${f.inventory.id}/exports/${staleExport.id}/download`)
    .expect(404);
  await f.api.get(`/inventory-imports/${staleImport.id}`).expect(404);
  assert.deepEqual(await readFile(f.runtime.config.settingsPath), settings);
  assert.equal(
    await readFile(
      join(f.runtime.config.attachmentsDirectory, `${f.file.id}.blob`),
      "utf8",
    ),
    "saved original",
  );
  const backups = (await f.api.get("/backups")).body;
  assert.equal(backups.length, 1);
  assert.equal(backups[0].metadata.kind, "pre-restore");
  assert.equal(backups[0].filename, result.body.safety_backup);
  const verify = await mkdtemp(join(f.root, "safety-check-"));
  await verifyBackup(
    join(f.runtime.config.backupsDirectory, result.body.safety_backup),
    verify,
  );
  const safety = openDatabase(join(verify, "verified.db"));
  try {
    assert.ok(
      safety.sqlite
        .prepare("SELECT id FROM inventories WHERE id = ?")
        .get(added.id),
    );
  } finally {
    safety.close();
  }
  const retry = await f.api
    .post(`/backup-restores/${preview.id}/confirm`)
    .set("X-Inventory-Generation", generation)
    .expect(200);
  assert.deepEqual(retry.body, result.body);
  assert.equal((await f.api.get("/inventories")).body.length, 2);
  assert.deepEqual(
    (await f.api.get(`/backup-restores/${preview.id}`)).body.receipt,
    result.body,
  );
  assert.equal((await f.api.get("/backups")).body.length, 1);
  await f.runtime.stop();
  const restarted = await startServer({ ...f.runtime.config, port: 0 });
  try {
    const api = request(restarted.server);
    assert.deepEqual(
      (await api.get(`/backup-restores/${preview.id}`).expect(200)).body
        .receipt,
      result.body,
    );
    assert.deepEqual(
      (await api.post(`/backup-restores/${preview.id}/confirm`).expect(200))
        .body,
      result.body,
    );
    assert.equal((await api.get("/inventories")).body.length, 2);
    assert.equal((await api.get("/backups")).body.length, 1);
  } finally {
    await restarted.stop();
  }
});

test("rejects incompatible database schemas and expires abandoned previews", async (context) => {
  const f = await fixture(context);
  const services = createServices(f.runtime.database.db, {
    directory: f.runtime.config.attachmentsDirectory,
    storageConfig: f.runtime.config,
  });
  const preview = await services.restores!.prepareStored(f.backup.filename);
  await services.restores!.cleanup(Date.now() + 31 * 60 * 1000);
  await assert.rejects(services.restores!.read(preview.id), {
    code: "backup_restore_not_found",
  });
  assert.deepEqual(await readdir(f.runtime.config.tempDirectory), []);
  const copy = join(f.root, "incompatible.db");
  await f.runtime.database.sqlite.backup(copy);
  const candidate = openDatabase(copy);
  candidate.sqlite.exec("CREATE TABLE unsupported_schema (id TEXT)");
  candidate.close();
  assert.throws(() => inspectRestoreDatabase(copy), {
    code: "invalid_backup_archive",
  });
  const changed = openDatabase(copy);
  changed.sqlite.exec("DROP TABLE unsupported_schema");
  changed.sqlite.exec("UPDATE inventory_items SET revision = 0");
  changed.close();
  assert.throws(() => inspectRestoreDatabase(copy), {
    code: "invalid_backup_archive",
  });
  const invalidView = openDatabase(copy);
  invalidView.sqlite.exec("UPDATE inventory_items SET revision = 1");
  invalidView.sqlite
    .prepare(
      "INSERT INTO inventory_views (inventory_id, revision, preferences) VALUES (?, 1, ?)",
    )
    .run(f.inventory.id, "{}");
  invalidView.close();
  assert.throws(() => inspectRestoreDatabase(copy), {
    code: "invalid_backup_archive",
  });
});

test("validates external uploads, cancels unused previews and rejects modified staging before creating a safety backup", async (context) => {
  const f = await fixture(context);
  const bytes = await readFile(
    join(f.runtime.config.backupsDirectory, f.backup.filename),
  );
  await f.api
    .post("/backup-restores")
    .set("Content-Type", "application/zip")
    .send(Buffer.from("invalid ZIP"))
    .expect(422);
  const preview = (
    await f.api
      .post("/backup-restores")
      .set("Content-Type", "application/zip")
      .send(bytes)
      .expect(201)
  ).body;
  await f.api.delete(`/backup-restores/${preview.id}`).expect(204);
  await f.api.post(`/backup-restores/${preview.id}/confirm`).expect(404);
  const changed = (
    await f.api
      .post("/backup-restores")
      .send({ filename: f.backup.filename })
      .expect(201)
  ).body;
  const workspace = (await readdir(f.runtime.config.tempDirectory)).find(
    (name) => name.startsWith("restore-preview-"),
  )!;
  await writeFile(
    join(f.runtime.config.tempDirectory, workspace, "backup.zip"),
    "changed",
  );
  await f.api.post(`/backup-restores/${changed.id}/confirm`).expect(422);
  assert.equal((await f.api.get("/backups")).body.length, 1);
  assert.equal((await f.api.get("/inventories")).body[0].id, f.inventory.id);
  assert.equal(f.runtime.database.sqlite.open, true);
});

test("keeps current data usable when the mandatory safety backup fails and permits an explicit retry", async (context) => {
  const f = await fixture(context);
  const preview = (
    await f.api
      .post("/backup-restores")
      .send({ filename: f.backup.filename })
      .expect(201)
  ).body;
  const path = join(f.runtime.config.attachmentsDirectory, `${f.file.id}.blob`);
  await writeFile(path, "corrupt");
  await f.api.post(`/backup-restores/${preview.id}/confirm`).expect(422);
  assert.equal(f.runtime.database.sqlite.open, true);
  assert.equal((await f.api.get("/backups")).body.length, 1);
  await writeFile(path, "saved original");
  await f.api.post(`/backup-restores/${preview.id}/confirm`).expect(200);
  assert.equal((await f.api.get("/backups")).body.length, 2);
});

for (const point of [
  "owner-pending",
  "marker-incomplete",
  "staging",
  "database-retained",
  "database-published",
  "both-published",
  "committed",
] as const) {
  test(`recovers an interruption at ${point} with independent SQLite storage`, async () => {
    const root = await mkdtemp(join(tmpdir(), "inventory-restore-recovery-"));
    const sourceConfig = loadConfig({
      INVENTORY_DATA_DIR: join(root, "source"),
    });
    const targetConfig = loadConfig({
      INVENTORY_DATA_DIR: join(root, "target"),
      INVENTORY_DB_PATH: join(root, "independent", "records.db"),
    });
    let source: ReturnType<typeof openDatabase> | undefined;
    let target: ReturnType<typeof openDatabase> | undefined;
    try {
      await initializeStorage(sourceConfig);
      await initializeStorage(targetConfig);
      source = openDatabase(sourceConfig.databasePath);
      target = openDatabase(targetConfig.databasePath);
      createServices(source.db).inventories.create({ name: "Restored" });
      createServices(target.db).inventories.create({ name: "Current" });
      const backup = await createBackup(sourceConfig, source);
      const safety = await createBackup(targetConfig, target, "pre-restore");
      const workspace = await mkdtemp(join(root, "extract-"));
      const manifest = await verifyBackup(
        join(sourceConfig.backupsDirectory, backup.filename),
        workspace,
        true,
      );
      const journal = await stageRestore(targetConfig, workspace, manifest, {
        id: randomUUID(),
        backup_id: manifest.id,
        safety_backup: safety.filename,
        completed_at: new Date().toISOString(),
      });
      target.close();
      const [database, attachments] = restoreContainers(journal);
      if (point === "owner-pending" || point === "marker-incomplete") {
        await rm(attachments, { recursive: true });
        await mkdir(attachments);
        const name =
          point === "owner-pending"
            ? `.restore-write-${randomUUID()}.tmp`
            : ".restore-owner";
        await writeFile(join(attachments, name), "{");
      }
      if (point === "database-retained" || point === "database-published") {
        await rename(targetConfig.databasePath, join(database, "previous"));
        if (point === "database-published")
          await rename(join(database, "incoming"), targetConfig.databasePath);
      } else if (point === "both-published" || point === "committed")
        await publishRestore(journal);
      if (point === "both-published" || point === "committed") {
        const reopened = openDatabase(targetConfig.databasePath);
        reopened.close();
      }
      if (point === "committed") await commitRestore(targetConfig, journal);
      const committed = await recoverRestore(targetConfig);
      assert.equal(committed, point === "committed");
      target = openDatabase(targetConfig.databasePath);
      const row = target.sqlite
        .prepare("SELECT name FROM inventories")
        .get() as { name: string };
      assert.equal(row.name, committed ? "Restored" : "Current");
      assert.equal(
        (await readdir(targetConfig.configDirectory)).includes(
          ".restore-journal.json",
        ),
        false,
      );
      assert.equal(
        (await readRestoreReceipt(targetConfig))?.id ?? null,
        committed ? journal.receipt.id : null,
      );
      assert.equal(await recoverRestore(targetConfig), false);
    } finally {
      source?.close();
      target?.close();
      await rm(root, { recursive: true, force: true });
    }
  });
}
