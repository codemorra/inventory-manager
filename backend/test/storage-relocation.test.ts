import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { setTimeout } from "node:timers/promises";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";
import { createStorageLocationService } from "../src/storage-relocation.js";

async function fixture(context: TestContext, separateDatabase = false) {
  const root = await mkdtemp(join(tmpdir(), "inventory-relocation-"));
  const config = {
    ...loadConfig({
      INVENTORY_DATA_DIR: join(root, "application"),
      ...(separateDatabase
        ? { INVENTORY_DB_PATH: join(root, "independent.db") }
        : {}),
    }),
    port: 0,
  };
  let runtime = await startServer(config);
  context.after(async () => {
    await runtime.stop();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    config,
    get runtime() {
      return runtime;
    },
    get api() {
      return request(runtime.server);
    },
    async restart() {
      await runtime.stop();
      runtime = await startServer(config);
    },
    async document() {
      return JSON.parse(await readFile(config.settingsPath, "utf8"));
    },
    async plan(
      dataDirectory = join(root, "new-data"),
      backupsDirectory = join(root, "new-backups"),
    ) {
      const state = (
        await request(runtime.server).get("/storage-locations").expect(200)
      ).body;
      const plan = await createStorageLocationService(runtime.config).schedule({
        expected_revision: state.revision,
        dataDirectory,
        backupsDirectory,
      });
      assert.ok(plan.pending);
      return { ...plan, pending: plan.pending };
    },
  };
}

async function seed(f: Awaited<ReturnType<typeof fixture>>) {
  const inventory = (
    await f.api.post("/inventories").send({ name: "Move me" }).expect(201)
  ).body;
  const field = (
    await f.api
      .post(`/inventories/${inventory.id}/fields`)
      .send({ name: "Files", field_type: "attachment" })
      .expect(201)
  ).body;
  const file = (
    await f.api
      .post(`/inventories/${inventory.id}/fields/${field.id}/attachments`)
      .set("Content-Type", "application/octet-stream")
      .set("X-File-Name", "saved.txt")
      .send(Buffer.from("Attachment bytes"))
      .expect(201)
  ).body;
  await f.api
    .post(`/inventories/${inventory.id}/items`)
    .send({ values: [{ field_id: field.id, value: [file.id] }] })
    .expect(201);
  await writeFile(
    join(f.config.backupsDirectory, "saved.zip"),
    "Existing backup",
  );
  return { inventory, field, file };
}

test("moves the latest database, attachments and backups at restart, then removes the original directories", async (context) => {
  const f = await fixture(context);
  const saved = await seed(f);
  f.runtime.database.sqlite.pragma("journal_mode = WAL");
  const plan = await f.plan();
  assert.equal(plan.paths.dataDirectory, f.config.dataDirectory);
  assert.equal(plan.pending.dataDirectory, join(f.root, "new-data"));
  await assert.rejects(stat(plan.pending.dataDirectory), { code: "ENOENT" });
  // Scheduling never freezes current application data or ordinary preference saves.
  await f.api
    .post("/inventories")
    .send({ name: "Saved after scheduling" })
    .expect(201);
  await f.api
    .patch("/application-settings")
    .send({ expected_revision: plan.revision, preferences: { theme: "dark" } })
    .expect(200);
  await f.restart();
  const status = (await f.api.get("/storage-locations").expect(200)).body;
  assert.equal(status.pending, null);
  assert.equal(status.cleanupPending, false);
  assert.equal(
    status.moveFailed,
    false,
    await readFile(
      join(f.config.logsDirectory, "inventory-manager.log"),
      "utf8",
    ),
  );
  assert.equal(status.paths.dataDirectory, plan.pending.dataDirectory);
  assert.equal(status.paths.backupsDirectory, plan.pending.backupsDirectory);
  const inventories = (await f.api.get("/inventories").expect(200)).body;
  assert.ok(
    inventories.some(
      (entry: { id: string }) => entry.id === saved.inventory.id,
    ),
  );
  assert.ok(
    inventories.some(
      (entry: { name: string }) => entry.name === "Saved after scheduling",
    ),
  );
  assert.equal(
    await readFile(
      join(status.paths.dataDirectory, "attachments", `${saved.file.id}.blob`),
      "utf8",
    ),
    "Attachment bytes",
  );
  assert.equal(
    await readFile(join(status.paths.backupsDirectory, "saved.zip"), "utf8"),
    "Existing backup",
  );
  await assert.rejects(stat(f.config.dataDirectory), { code: "ENOENT" });
  await assert.rejects(stat(f.config.backupsDirectory), { code: "ENOENT" });
  assert.deepEqual(
    (await readdir(status.paths.dataDirectory))
      .filter(
        (name) => !["inventory.db-wal", "inventory.db-shm"].includes(name),
      )
      .sort(),
    ["attachments", "inventory.db"],
  );
  assert.equal(
    (await f.api.get("/application-settings").expect(200)).body.preferences
      .theme,
    "dark",
  );
  await f.restart();
  assert.equal((await f.api.get("/inventories").expect(200)).body.length, 2);
});

test("validates destinations, rejects stale changes and allows canceling a scheduled move", async (context) => {
  const f = await fixture(context);
  const status = (await f.api.get("/storage-locations").expect(200)).body;
  const input = {
    expected_revision: status.revision,
    dataDirectory: join(f.root, "new-data"),
    backupsDirectory: join(f.root, "new-backups"),
  };
  const occupied = join(f.root, "occupied");
  await mkdir(occupied);
  await writeFile(join(occupied, "keep.txt"), "Keep");
  for (const change of [
    { dataDirectory: "relative" },
    { dataDirectory: f.config.storageRoot },
    { backupsDirectory: occupied },
    { backupsDirectory: join(input.dataDirectory, "backups") },
  ])
    await f.api
      .put("/storage-locations")
      .send({ ...input, ...change })
      .expect(422);
  const plan = await f.plan(input.dataDirectory, input.backupsDirectory);
  await f.api
    .delete("/storage-locations")
    .send({ expected_revision: status.revision })
    .expect(409);
  await f.api
    .put("/storage-locations")
    .send({ ...input, expected_revision: plan.revision })
    .expect(409);
  const canceled = (
    await f.api
      .delete("/storage-locations")
      .send({ expected_revision: plan.revision })
      .expect(200)
  ).body;
  assert.equal(canceled.pending, null);
  await f.restart();
  assert.equal(f.runtime.config.dataDirectory, f.config.dataDirectory);
  await assert.rejects(stat(input.dataDirectory), { code: "ENOENT" });
  assert.equal(await readFile(join(occupied, "keep.txt"), "utf8"), "Keep");
});

test("keeps existing storage usable when a destination becomes occupied before restart", async (context) => {
  const f = await fixture(context);
  await seed(f);
  const plan = await f.plan();
  await mkdir(plan.pending.dataDirectory);
  await writeFile(
    join(plan.pending.dataDirectory, "keep.txt"),
    "Unrelated content",
  );
  await f.restart();
  const status = (await f.api.get("/storage-locations").expect(200)).body;
  assert.equal(status.moveFailed, true);
  assert.equal(status.pending, null);
  assert.equal(f.runtime.config.dataDirectory, f.config.dataDirectory);
  assert.equal(
    (await f.api.get("/inventories").expect(200)).body[0].name,
    "Move me",
  );
  assert.equal(
    await readFile(join(plan.pending.dataDirectory, "keep.txt"), "utf8"),
    "Unrelated content",
  );
});

test("rolls back the first directory when copying the second fails", async (context) => {
  const f = await fixture(context);
  await seed(f);
  const plan = await f.plan();
  await symlink(
    join(f.root, "missing"),
    join(f.config.backupsDirectory, "unsupported-link"),
    "junction",
  );
  await f.restart();
  const status = (await f.api.get("/storage-locations").expect(200)).body;
  assert.equal(status.moveFailed, true);
  assert.equal(status.paths.dataDirectory, f.config.dataDirectory);
  assert.equal(
    (await f.api.get("/inventories").expect(200)).body[0].name,
    "Move me",
  );
  await assert.rejects(stat(plan.pending.dataDirectory), { code: "ENOENT" });
  assert.equal(
    await readFile(join(f.config.backupsDirectory, "saved.zip"), "utf8"),
    "Existing backup",
  );
});

test("recovers an interruption after publishing a copy and retaining its original under a private name", async (context) => {
  const f = await fixture(context);
  await seed(f);
  await f.plan();
  await f.runtime.stop();
  const document = await f.document();
  const move = document.storage.relocation;
  await cp(move.source.dataDirectory, move.target.dataDirectory, {
    recursive: true,
  });
  for (const path of [move.source.dataDirectory, move.target.dataDirectory])
    await writeFile(
      join(path, ".inventory-manager-move.json"),
      JSON.stringify({ id: move.id }),
    );
  const old = `${move.source.dataDirectory}.inventory-old-${move.id}`;
  await rename(move.source.dataDirectory, old);
  await f.restart();
  assert.equal(f.runtime.config.dataDirectory, move.target.dataDirectory);
  assert.equal(
    (await f.api.get("/inventories").expect(200)).body[0].name,
    "Move me",
  );
  await assert.rejects(stat(old), { code: "ENOENT" });
  assert.equal(
    (await f.api.get("/storage-locations").expect(200)).body.cleanupPending,
    false,
  );
});

test("finishes source cleanup after an interruption following settings activation", async (context) => {
  const f = await fixture(context);
  await seed(f);
  await f.plan();
  await f.runtime.stop();
  const document = await f.document();
  const move = document.storage.relocation;
  for (const key of ["dataDirectory", "backupsDirectory"] as const) {
    await cp(move.source[key], move.target[key], { recursive: true });
    for (const path of [move.source[key], move.target[key]])
      await writeFile(
        join(path, ".inventory-manager-move.json"),
        JSON.stringify({ id: move.id }),
      );
    await rename(
      move.source[key],
      `${move.source[key]}.inventory-old-${move.id}`,
    );
  }
  // A crash can occur after the last old file/marker was removed but before rmdir.
  const emptyOld = `${move.source.backupsDirectory}.inventory-old-${move.id}`;
  await rm(emptyOld, { recursive: true });
  await mkdir(emptyOld);
  document.storage = {
    ...document.storage,
    ...move.target,
    relocation: { ...move, phase: "cleanup" },
  };
  await writeFile(f.config.settingsPath, JSON.stringify(document));
  await f.restart();
  assert.equal(f.runtime.config.dataDirectory, move.target.dataDirectory);
  assert.equal(
    (await f.api.get("/inventories").expect(200)).body[0].name,
    "Move me",
  );
  for (const key of ["dataDirectory", "backupsDirectory"] as const)
    await assert.rejects(stat(`${move.source[key]}.inventory-old-${move.id}`), {
      code: "ENOENT",
    });
  assert.equal(
    (await f.api.get("/storage-locations").expect(200)).body.cleanupPending,
    false,
  );
});

test("prevents a second backend from accessing the same application root during a pending move", async (context) => {
  const f = await fixture(context);
  const plan = await f.plan();
  await assert.rejects(startServer(f.config), /locked/);
  await assert.rejects(stat(plan.pending.dataDirectory), { code: "ENOENT" });
  await f.restart();
  assert.equal(f.runtime.config.dataDirectory, plan.pending.dataDirectory);
});

test("keeps explicit independent SQLite storage fixed while allowing backup relocation", async (context) => {
  const f = await fixture(context, true);
  await seed(f);
  const state = (await f.api.get("/storage-locations").expect(200)).body;
  assert.equal(state.dataMovable, false);
  await f.api
    .put("/storage-locations")
    .send({
      expected_revision: state.revision,
      dataDirectory: join(f.root, "new-data"),
      backupsDirectory: join(f.root, "new-backups"),
    })
    .expect(409);
  await f.plan(state.paths.dataDirectory);
  await f.restart();
  assert.equal(f.runtime.config.databasePath, f.config.databasePath);
  assert.equal(f.runtime.config.dataDirectory, f.config.dataDirectory);
  assert.equal(f.runtime.config.backupsDirectory, join(f.root, "new-backups"));
  assert.equal(
    (await f.api.get("/inventories").expect(200)).body[0].name,
    "Move me",
  );
});

test("switches storage live and preserves prepared exports, attachment access and subsequent database writes", async (context) => {
  const f = await fixture(context);
  const saved = await seed(f);
  const prepared = (
    await f.api.post(`/inventories/${saved.inventory.id}/exports`).expect(201)
  ).body;
  const status = (await f.api.get("/storage-locations").expect(200)).body;
  const target = {
    dataDirectory: join(f.root, "live-data"),
    backupsDirectory: join(f.root, "live-backups"),
  };
  const moved = (
    await f.api
      .put("/storage-locations/")
      .send({ expected_revision: status.revision, ...target })
      .expect(200)
  ).body;
  assert.equal(moved.pending, null);
  assert.equal(moved.moveFailed, false);
  assert.equal(moved.paths.dataDirectory, target.dataDirectory);
  assert.equal(
    f.runtime.config.databasePath,
    join(target.dataDirectory, "inventory.db"),
  );
  assert.deepEqual(moved.defaults, {
    dataDirectory: f.config.dataDirectory,
    backupsDirectory: f.config.backupsDirectory,
  });
  assert.equal(
    (await f.api.get("/inventories").expect(200)).body[0].id,
    saved.inventory.id,
  );
  assert.equal(
    await readFile(
      join(target.dataDirectory, "attachments", `${saved.file.id}.blob`),
      "utf8",
    ),
    "Attachment bytes",
  );
  await f.api
    .get(`/inventories/${saved.inventory.id}/exports/${prepared.id}/download`)
    .expect(200);
  await f.api
    .post("/inventories")
    .send({ name: "Created after live switch" })
    .expect(201);
  await assert.rejects(stat(f.config.dataDirectory), { code: "ENOENT" });
  const restored = (
    await f.api
      .put("/storage-locations")
      .send({ expected_revision: moved.revision, ...moved.defaults })
      .expect(200)
  ).body;
  assert.equal(restored.paths.dataDirectory, f.config.dataDirectory);
  assert.equal(restored.moveFailed, false);
  assert.equal((await f.api.get("/inventories").expect(200)).body.length, 2);
  await f.restart();
  assert.equal((await f.api.get("/inventories").expect(200)).body.length, 2);
});

test("waits for a streamed upload before switching storage and continues serving queued requests", async (context) => {
  const f = await fixture(context);
  const saved = await seed(f);
  const address = f.runtime.server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let finishUpload!: () => void;
  const uploaded = new Promise<{ id: string }>((resolve, reject) => {
    const upload = httpRequest(
      `${origin}/inventories/${saved.inventory.id}/fields/${saved.field.id}/attachments`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": "streamed.txt",
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            assert.equal(response.statusCode, 201);
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    upload.on("error", reject);
    upload.write("First chunk");
    finishUpload = () => upload.end(" and final chunk");
    context.after(() => upload.destroy());
  });
  let observed = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      (await readdir(f.config.attachmentsDirectory)).some((name) =>
        name.endsWith(".upload"),
      )
    ) {
      observed = true;
      break;
    }
    await setTimeout(5);
  }
  assert.equal(observed, true);
  const status = (await f.api.get("/storage-locations").expect(200)).body;
  const target = {
    dataDirectory: join(f.root, "streamed-data"),
    backupsDirectory: f.config.backupsDirectory,
  };
  let completed = false;
  const moving = f.api
    .put("/storage-locations")
    .send({ expected_revision: status.revision, ...target })
    .expect(200)
    .then((response) => {
      completed = true;
      return response.body;
    });
  await setTimeout(20);
  assert.equal(completed, false);
  const queued = fetch(`${origin}/inventories`).then((response) =>
    response.json(),
  );
  finishUpload();
  const file = await uploaded;
  const moved = await moving;
  assert.equal(moved.paths.dataDirectory, target.dataDirectory);
  assert.equal((await queued)[0].id, saved.inventory.id);
  const download = await fetch(
    `${origin}/inventories/${saved.inventory.id}/fields/${saved.field.id}/attachments/${file.id}/download`,
  );
  assert.equal(await download.text(), "First chunk and final chunk");
});

test("preserves open import previews and completed confirmation receipts across a live switch", async (context) => {
  const f = await fixture(context);
  const saved = await seed(f);
  const address = f.runtime.server.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const prepared = (
    await f.api.post(`/inventories/${saved.inventory.id}/exports`).expect(201)
  ).body;
  const archive = Buffer.from(
    await (
      await fetch(
        `${origin}/inventories/${saved.inventory.id}/exports/${prepared.id}/download`,
      )
    ).arrayBuffer(),
  );
  const preview = (
    await f.api
      .post("/inventory-imports")
      .set("Content-Type", "application/zip")
      .send(archive)
      .expect(201)
  ).body;
  const receipt = (
    await f.api
      .post("/inventory-imports")
      .set("Content-Type", "application/zip")
      .send(archive)
      .expect(201)
  ).body;
  const confirmed = (
    await f.api
      .post(`/inventory-imports/${receipt.id}/confirm`)
      .send({ name: "Receipt import" })
      .expect(200)
  ).body;
  const state = (await f.api.get("/storage-locations").expect(200)).body;
  await f.api
    .put("/storage-locations")
    .send({
      expected_revision: state.revision,
      dataDirectory: join(f.root, "import-data"),
      backupsDirectory: state.paths.backupsDirectory,
    })
    .expect(200);
  const repeated = (
    await f.api
      .post(`/inventory-imports/${receipt.id}/confirm`)
      .send({ name: "Receipt import" })
      .expect(200)
  ).body;
  assert.equal(repeated.id, confirmed.id);
  await f.api
    .post(`/inventory-imports/${preview.id}/confirm`)
    .send({ name: "After live move" })
    .expect(200);
  assert.equal((await f.api.get("/inventories").expect(200)).body.length, 3);
});
