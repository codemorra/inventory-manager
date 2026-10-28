import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request as httpRequest } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test, { type TestContext } from "node:test";
import Database from "better-sqlite3";
import { openPromise } from "yauzl";
import { ZipFile } from "yazl";
import request, { type Response } from "supertest";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import { initializeStorage } from "../src/storage.js";
import {
  cleanupBackupWorkspaces,
  createBackup,
} from "../src/backups/service.js";
import { verifyBackup } from "../src/backups/archive.js";
import { backupManifestSchema } from "../src/backups/manifest.js";
import { startServer } from "../src/server.js";
import { createBackupCatalog } from "../src/backups/catalog.js";

/**
 * Collect only small synthetic ZIP responses for byte-for-byte HTTP assertions.
 * @param response The test HTTP download stream.
 * @param done Report the collected bytes or an interrupted response.
 * @returns No value; the parser reports completion through its callback.
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

/** Isolate every backup, database and filesystem operation from development storage. */
async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "inventory-backup-test-"));
  const config = loadConfig({ INVENTORY_DATA_DIR: root });
  await initializeStorage(config);
  const connection = openDatabase(config.databasePath);
  const services = createServices(connection.db, {
    directory: config.attachmentsDirectory,
  });
  context.after(async () => {
    connection.close();
    await rm(root, { recursive: true, force: true });
  });
  const inventory = services.inventories.create({ name: "Saved inventory" });
  const field = services.fields.create(inventory.id, {
    name: "Files",
    field_type: "attachment",
  });
  const file = await services.attachments!.upload(
    inventory.id,
    field.id,
    { filename: "sample.txt", media_type: "text/plain" },
    Readable.from([Buffer.from("saved original")]),
  );
  services.items.create(inventory.id, {
    values: [{ field_id: field.id, value: [file.id] }],
  });
  return { root, config, connection, services, inventory, file };
}

/** Independently decode small synthetic ZIPs to inspect exact backup bytes. */
async function contents(path: string) {
  const zip = await openPromise(path, { lazyEntries: true, autoClose: false });
  try {
    const entries = new Map<string, Buffer>();
    for await (const entry of zip.eachEntry()) {
      const stream = await zip.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      entries.set(entry.fileName, Buffer.concat(chunks));
    }
    return entries;
  } finally {
    zip.close();
  }
}

/** Repack changed entries with valid ZIP CRCs so validation must detect semantic/checksum failures. */
async function repack(path: string, entries: Map<string, Buffer>) {
  const zip = new ZipFile();
  for (const [name, bytes] of entries) zip.addBuffer(bytes, name);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream as Readable)
    chunks.push(Buffer.from(chunk));
  await writeFile(path, Buffer.concat(chunks));
}

test("backs up the complete WAL snapshot, inventory views and managed originals", async (context) => {
  const f = await fixture(context);
  f.connection.sqlite.pragma("journal_mode = WAL");
  f.services.templates.create({ name: "Saved template", fields: [] });
  const view = f.services.views.update(f.inventory.id, {
    expected_revision: 0,
    preferences: {
      ...f.services.views.read(f.inventory.id).preferences,
      wrapText: false,
      attachmentPreviews: true,
    },
  });
  const originalSettings = await readFile(f.config.settingsPath);
  await writeFile(join(f.config.tempDirectory, "unrelated.txt"), "scratch");
  await writeFile(
    join(f.config.attachmentsDirectory, "unrelated.txt"),
    "not managed",
  );
  await writeFile(
    join(f.config.backupsDirectory, "keep.zip"),
    "previous backup",
  );
  const result = await createBackup(f.config, f.connection);
  assert.equal(result.kind, "manual");
  const entries = await contents(
    join(f.config.backupsDirectory, result.filename),
  );
  assert.deepEqual(
    [...entries.keys()].sort(),
    ["backup.json", "inventory.db", `attachments/${f.file.id}.blob`].sort(),
  );
  assert.equal(
    entries.get(`attachments/${f.file.id}.blob`)!.toString(),
    "saved original",
  );
  const manifest = backupManifestSchema.parse(
    JSON.parse(entries.get("backup.json")!.toString()),
  );
  assert.equal(manifest.id, result.id);
  const dbPath = join(f.root, "independent.db");
  await writeFile(dbPath, entries.get("inventory.db")!);
  const database = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    assert.equal(
      (database.prepare("SELECT id FROM inventories").get() as { id: string })
        .id,
      f.inventory.id,
    );
    assert.equal(
      (
        database
          .prepare("SELECT count(*) AS count FROM inventory_templates")
          .get() as { count: number }
      ).count,
      1,
    );
    const storedView = database
      .prepare(
        "SELECT revision, preferences FROM inventory_views WHERE inventory_id = ?",
      )
      .get(f.inventory.id) as { revision: number; preferences: string };
    assert.equal(storedView.revision, view.revision);
    assert.deepEqual(JSON.parse(storedView.preferences), view.preferences);
    assert.equal(
      (
        database
          .prepare("SELECT count(*) AS count FROM inventory_items")
          .get() as { count: number }
      ).count,
      1,
    );
  } finally {
    database.close();
  }
  assert.deepEqual(await readFile(f.config.settingsPath), originalSettings);
  assert.equal(
    await readFile(join(f.config.backupsDirectory, "keep.zip"), "utf8"),
    "previous backup",
  );
  assert.deepEqual(await readdir(f.config.tempDirectory), ["unrelated.txt"]);
  assert.equal((await readdir(f.config.backupsDirectory)).length, 2);
});

test("backs up a database with retained deletion history and no active attachments", async (context) => {
  const f = await fixture(context);
  f.services.inventories.delete(f.inventory.id);
  await f.services.attachments!.cleanup();
  const result = await createBackup(f.config, f.connection);
  const entries = await contents(
    join(f.config.backupsDirectory, result.filename),
  );
  assert.deepEqual([...entries.keys()].sort(), ["backup.json", "inventory.db"]);
  const manifest = backupManifestSchema.parse(
    JSON.parse(entries.get("backup.json")!.toString()),
  );
  assert.deepEqual(
    manifest.files.map((file) => file.path),
    ["inventory.db"],
  );
});

test("refuses missing, corrupt and linked live attachments without publishing a backup", async (context) => {
  const f = await fixture(context);
  const path = join(f.config.attachmentsDirectory, `${f.file.id}.blob`);
  await writeFile(path, "wrong original");
  await assert.rejects(createBackup(f.config, f.connection), {
    code: "invalid_backup_archive",
  });
  await rm(path);
  await assert.rejects(createBackup(f.config, f.connection));
  const outside = join(f.root, "outside.txt");
  await writeFile(outside, "saved original");
  await symlink(outside, path);
  await assert.rejects(createBackup(f.config, f.connection), {
    code: "invalid_backup_archive",
  });
  assert.deepEqual(await readdir(f.config.backupsDirectory), []);
  assert.deepEqual(await readdir(f.config.tempDirectory), []);
  assert.equal(f.services.inventories.get(f.inventory.id).id, f.inventory.id);
});

test("validates ZIP checksums, exact contents, database and attachment references", async (context) => {
  const f = await fixture(context);
  const backup = await createBackup(f.config, f.connection);
  const entries = await contents(
    join(f.config.backupsDirectory, backup.filename),
  );
  const replaceFile = (
    files: Map<string, Buffer>,
    path: string,
    bytes: Buffer,
  ) => {
    files.set(path, bytes);
    const manifest = JSON.parse(files.get("backup.json")!.toString());
    const file = manifest.files.find(
      (entry: { path: string }) => entry.path === path,
    );
    file.byte_size = bytes.length;
    file.sha256 = createHash("sha256").update(bytes).digest("hex");
    files.set("backup.json", Buffer.from(JSON.stringify(manifest)));
  };
  const variants: [string, (files: Map<string, Buffer>) => void][] = [
    [
      "changed bytes",
      (files) =>
        files.set(
          `attachments/${f.file.id}.blob`,
          Buffer.from("other original"),
        ),
    ],
    [
      "missing attachment",
      (files) => {
        files.delete(`attachments/${f.file.id}.blob`);
      },
    ],
    [
      "unexpected file",
      (files) => files.set("extra.txt", Buffer.from("unexpected")),
    ],
    [
      "missing database",
      (files) => {
        files.delete("inventory.db");
        const manifest = JSON.parse(files.get("backup.json")!.toString());
        manifest.files = manifest.files.filter(
          (file: { path: string }) => file.path !== "inventory.db",
        );
        files.set("backup.json", Buffer.from(JSON.stringify(manifest)));
      },
    ],
    [
      "invalid database with valid checksum",
      (files) => replaceFile(files, "inventory.db", Buffer.from("not SQLite")),
    ],
    [
      "unsupported version",
      (files) => {
        const manifest = JSON.parse(files.get("backup.json")!.toString());
        manifest.version = 2;
        files.set("backup.json", Buffer.from(JSON.stringify(manifest)));
      },
    ],
    [
      "duplicate manifest path",
      (files) => {
        const manifest = JSON.parse(files.get("backup.json")!.toString());
        manifest.files.push(manifest.files[0]);
        files.set("backup.json", Buffer.from(JSON.stringify(manifest)));
      },
    ],
  ];
  for (const [name, mutate] of variants) {
    const changed = new Map(entries);
    mutate(changed);
    const archive = join(f.root, "invalid.zip");
    await repack(archive, changed);
    const workspace = await mkdtemp(join(f.config.tempDirectory, "verify-"));
    await assert.rejects(
      verifyBackup(archive, workspace),
      { code: "invalid_backup_archive" },
      name,
    );
    await rm(workspace, { recursive: true });
  }
  // A valid checksum must not disguise an unrelated database attachment identity.
  const changed = new Map(entries);
  const manifest = JSON.parse(changed.get("backup.json")!.toString());
  const oldPath = `attachments/${f.file.id}.blob`;
  const newPath = "attachments/00000000-0000-4000-8000-000000000000.blob";
  manifest.files.find((file: { path: string }) => file.path === oldPath).path =
    newPath;
  changed.set(newPath, changed.get(oldPath)!);
  changed.delete(oldPath);
  changed.set("backup.json", Buffer.from(JSON.stringify(manifest)));
  const archive = join(f.root, "mismatch.zip");
  await repack(archive, changed);
  await assert.rejects(verifyBackup(archive, f.config.tempDirectory), {
    code: "invalid_backup_archive",
  });
});

test("reconciles abandoned private workspaces while preserving completed backups and unrelated files", async (context) => {
  const f = await fixture(context);
  await mkdir(join(f.config.tempDirectory, "backup-ABC123"));
  await mkdir(join(f.config.backupsDirectory, ".backup-ABC123"));
  await mkdir(join(f.config.tempDirectory, "backup-not-owned"));
  await writeFile(join(f.config.backupsDirectory, "keep.zip"), "keep");
  await cleanupBackupWorkspaces(f.config);
  assert.deepEqual(await readdir(f.config.tempDirectory), ["backup-not-owned"]);
  assert.deepEqual(await readdir(f.config.backupsDirectory), ["keep.zip"]);
});

test("lists durable backups with bounded metadata and retains unreadable archives without exposing unrelated files", async (context) => {
  const f = await fixture(context);
  const backup = await createBackup(f.config, f.connection);
  const catalog = createBackupCatalog(f.config);
  const broken =
    "backup-9999-01-01T00-00-00-000Z-00000000-0000-4000-8000-000000000000.zip";
  const linked =
    "backup-9998-01-01T00-00-00-000Z-00000000-0000-4000-8000-000000000000.zip";
  const directory =
    "backup-9997-01-01T00-00-00-000Z-00000000-0000-4000-8000-000000000000.zip";
  await writeFile(join(f.config.backupsDirectory, broken), "damaged archive");
  await symlink(
    join(f.config.backupsDirectory, backup.filename),
    join(f.config.backupsDirectory, linked),
  );
  await mkdir(join(f.config.backupsDirectory, directory));
  await writeFile(
    join(f.config.backupsDirectory, "unrelated.zip"),
    "unrelated",
  );
  const entries = await catalog.list();
  assert.deepEqual(entries, [
    { filename: broken, byte_size: 15, metadata: null },
    {
      filename: backup.filename,
      byte_size: backup.byte_size,
      metadata: {
        id: backup.id,
        created_at: backup.created_at,
        kind: "manual",
      },
    },
  ]);
  for (const filename of [
    "../inventory.db",
    "..\\inventory.db",
    "unrelated.zip",
    linked,
    directory,
  ])
    await assert.rejects(catalog.download(filename), {
      code: "backup_not_found",
    });
  for (let attempt = 0; attempt < 2; attempt++) {
    const download = await catalog.download(backup.filename);
    const chunks: Buffer[] = [];
    for await (const chunk of download.stream) chunks.push(Buffer.from(chunk));
    assert.deepEqual(
      Buffer.concat(chunks),
      await readFile(join(f.config.backupsDirectory, backup.filename)),
    );
  }
  assert.deepEqual(await readdir(f.config.tempDirectory), []);
});

test("serves manual backups from the runtime, survives errors and follows relocated storage", async () => {
  const root = await mkdtemp(join(tmpdir(), "inventory-backup-runtime-"));
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    runtime = await startServer({
      ...loadConfig({ INVENTORY_DATA_DIR: root }),
      port: 0,
    });
    const api = request(runtime.server);
    await api.get("/backups").expect(200, []);
    await api.post("/inventories").send({ name: "Saved" }).expect(201);
    const backup = await api.post("/backups").expect(201);
    assert.equal(backup.headers["cache-control"], "no-store");
    assert.equal(backup.body.kind, "manual");
    const list = await api.get("/backups").expect(200);
    assert.equal(list.headers["cache-control"], "no-store");
    assert.equal(list.body[0].filename, backup.body.filename);
    assert.equal(list.body[0].metadata.id, backup.body.id);
    const url = `/backups/${backup.body.filename}/download`;
    const head = await api.head(url).expect(200);
    assert.equal(Number(head.headers["content-length"]), backup.body.byte_size);
    const downloaded = await api
      .get(url)
      .buffer(true)
      .parse(binaryBody)
      .expect(200);
    assert.equal(downloaded.headers["content-type"], "application/zip");
    assert.equal(downloaded.headers["x-content-type-options"], "nosniff");
    assert.equal(downloaded.headers["cache-control"], "no-store");
    assert.match(downloaded.headers["content-disposition"]!, /^attachment;/);
    assert.deepEqual(
      downloaded.body,
      await readFile(
        join(runtime.config.backupsDirectory, backup.body.filename),
      ),
    );
    assert.deepEqual(await readdir(runtime.config.backupsDirectory), [
      backup.body.filename,
    ]);
    const state = (await api.get("/storage-locations").expect(200)).body;
    const target = join(root, "relocated-backups");
    await api
      .put("/storage-locations")
      .send({
        expected_revision: state.revision,
        dataDirectory: state.paths.dataDirectory,
        backupsDirectory: target,
      })
      .expect(200);
    const next = await api.post("/backups").expect(201);
    assert.equal((await api.get("/backups").expect(200)).body.length, 2);
    await api.get(url).expect(200);
    await api.get("/backups/not-a-backup/download").expect(404);
    assert.deepEqual(
      (await readdir(target)).sort(),
      [backup.body.filename, next.body.filename].sort(),
    );
    // Backup failure must release waiting requests without modifying existing backups.
    const inventory = (await api.get("/inventories").expect(200)).body[0];
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
        .set("X-File-Name", "sample.txt")
        .send(Buffer.from("original"))
        .expect(201)
    ).body;
    await writeFile(
      join(runtime.config.attachmentsDirectory, `${file.id}.blob`),
      "corrupt!",
    );
    await api.post("/backups").expect(422);
    await api.get("/health").expect(200);
    assert.deepEqual(
      (await readdir(target)).sort(),
      [backup.body.filename, next.body.filename].sort(),
    );
    await api.get("/inventories").expect(200);
    assert.deepEqual(await readdir(runtime.config.tempDirectory), []);
  } finally {
    await runtime?.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test(
  "waits for an in-flight upload before taking a backup and releases queued requests afterward",
  { timeout: 15_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "inventory-backup-drain-"));
    let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
    let upload: ReturnType<typeof httpRequest> | undefined;
    try {
      runtime = await startServer({
        ...loadConfig({ INVENTORY_DATA_DIR: root }),
        port: 0,
      });
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
      const address = runtime.server.address();
      assert.ok(address && typeof address !== "string");
      const receivedUpload = new Promise<void>((resolve) =>
        runtime!.server.once("request", () => resolve()),
      );
      const uploaded = new Promise<void>((resolve, reject) => {
        upload = httpRequest(
          {
            hostname: "127.0.0.1",
            port: address.port,
            method: "POST",
            path: `/inventories/${inventory.id}/fields/${field.id}/attachments`,
            headers: {
              "Content-Type": "application/octet-stream",
              "X-File-Name": "stream.txt",
            },
          },
          (response) => {
            response.resume();
            response.once("end", () =>
              response.statusCode === 201
                ? resolve()
                : reject(new Error(`Upload failed: ${response.statusCode}`)),
            );
          },
        );
        upload.on("error", reject);
        upload.write("before ");
      });
      void uploaded.catch(() => {});
      await receivedUpload;
      const receivedBackup = new Promise<void>((resolve) =>
        runtime!.server.once("request", () => resolve()),
      );
      const saved = api
        .post("/backups")
        .expect(201)
        .then((response) => response.body);
      await receivedBackup;
      const receivedRead = new Promise<void>((resolve) =>
        runtime!.server.once("request", () => resolve()),
      );
      const queued = api
        .get("/inventories")
        .expect(200)
        .then((response) => response.body);
      await receivedRead;
      assert.deepEqual(await readdir(runtime.config.backupsDirectory), []);
      upload!.end("after");
      await uploaded;
      const result = await saved;
      await queued;
      const entries = await contents(
        join(runtime.config.backupsDirectory, result.filename),
      );
      const attachment = [...entries].find(([path]) =>
        path.startsWith("attachments/"),
      );
      assert.ok(attachment);
      assert.equal(attachment[1].toString(), "before after");
    } finally {
      upload?.destroy();
      await runtime?.stop();
      await rm(root, { recursive: true, force: true });
    }
  },
);
