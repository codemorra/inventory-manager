import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import test, { type TestContext } from "node:test";
import request from "supertest";
import {
  automaticBackupPeriod,
  createAutomaticBackups,
  type AutomaticBackupOptions,
} from "../src/backups/automatic.js";
import {
  emptyAutomaticState,
  readAutomaticState,
  writeAutomaticState,
} from "../src/backups/automatic-state.js";
import { createBackupCatalog } from "../src/backups/catalog.js";
import { createBackup } from "../src/backups/service.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import { createSettingsService } from "../src/settings/service.js";
import { initializeStorage } from "../src/storage.js";
import { startServer } from "../src/server.js";

/**
 * Compose a real isolated archive store with a deterministic scheduler clock.
 * @param context The test's automatic cleanup scope.
 * @returns Database, settings, clock and a factory for independently restarted scheduler instances.
 */
async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "inventory-automatic-backup-"));
  const config = loadConfig({ INVENTORY_DATA_DIR: root });
  await initializeStorage(config);
  const connection = openDatabase(config.databasePath);
  createServices(connection.db).inventories.create({ name: "Saved" });
  const catalog = createBackupCatalog(config);
  const settings = createSettingsService(config.settingsPath);
  await settings.updateBackupPolicy({
    expected_revision: 0,
    policy: { frequency: "daily", retention: 2 },
  });
  const clock = { value: new Date("2026-10-28T12:00:00.000Z") };
  const calls: string[] = [];
  const errors: unknown[] = [];
  const engines: ReturnType<typeof createAutomaticBackups>[] = [];
  /**
   * Construct a fresh scheduler while retaining its real durable ledger and archive catalog.
   * @param overrides Optional creation/exclusivity hooks for failure and concurrency scenarios.
   * @returns An independently restartable scheduler using the deterministic clock.
   */
  function engine(overrides: Partial<AutomaticBackupOptions> = {}) {
    const scheduler = createAutomaticBackups(config, catalog, {
      now: () => new Date(clock.value),
      onError: (error) => {
        errors.push(error);
      },
      exclusive: async (work) => {
        await work();
        return true;
      },
      create: async (identity) => {
        calls.push(identity.id);
        return createBackup(config, connection, "automatic", identity);
      },
      ...overrides,
    });
    engines.push(scheduler);
    return scheduler;
  }
  context.after(async () => {
    for (const scheduler of engines) await scheduler.stop();
    connection.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    root,
    config,
    connection,
    catalog,
    settings,
    clock,
    calls,
    errors,
    engine,
  };
}

test("uses local calendar days and Monday-based weeks across daylight saving and year boundaries", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Berlin";
  try {
    assert.equal(
      automaticBackupPeriod(new Date("2026-03-28T23:30:00Z"), "daily"),
      "2026-03-29",
    );
    assert.equal(
      automaticBackupPeriod(new Date("2026-03-29T21:30:00Z"), "daily"),
      "2026-03-29",
    );
    assert.equal(
      automaticBackupPeriod(new Date("2026-03-29T22:30:00Z"), "daily"),
      "2026-03-30",
    );
    assert.equal(
      automaticBackupPeriod(new Date("2026-10-25T00:30:00Z"), "daily"),
      automaticBackupPeriod(new Date("2026-10-25T01:30:00Z"), "daily"),
    );
    assert.equal(
      automaticBackupPeriod(new Date("2025-12-29T12:00:00Z"), "weekly"),
      "2025-12-29",
    );
    assert.equal(
      automaticBackupPeriod(new Date("2026-01-04T12:00:00Z"), "weekly"),
      "2025-12-29",
    );
    assert.equal(
      automaticBackupPeriod(new Date("2026-01-05T12:00:00Z"), "weekly"),
      "2026-01-05",
    );
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test("keeps manual/safety backups independent, skips duplicate periods across restart and catches up only once", async (context) => {
  const f = await fixture(context);
  const manual = await createBackup(f.config, f.connection, "manual", {
    id: randomUUID(),
    created_at: f.clock.value.toISOString(),
  });
  const safety = await createBackup(f.config, f.connection, "pre-restore", {
    id: randomUUID(),
    created_at: f.clock.value.toISOString(),
  });
  const revision = (await f.settings.readBackupPolicy()).revision;
  const scheduler = f.engine();
  await scheduler.tick();
  await scheduler.tick();
  await scheduler.stop();
  const restarted = f.engine();
  await restarted.tick();
  assert.equal(f.calls.length, 1);
  assert.equal((await f.settings.readBackupPolicy()).revision, revision);
  f.clock.value = new Date("2026-10-31T12:00:00.000Z");
  await restarted.tick();
  assert.equal(f.calls.length, 2);
  await f.settings.updateBackupPolicy({
    expected_revision: revision,
    policy: { frequency: "weekly", retention: 2 },
  });
  await restarted.tick();
  assert.equal(f.calls.length, 2);
  f.clock.value = new Date("2026-11-02T12:00:00.000Z");
  await restarted.tick();
  assert.equal(f.calls.length, 3);
  const list = await f.catalog.list();
  assert.equal(
    list.filter((entry) => entry.metadata?.kind === "automatic").length,
    2,
  );
  assert.ok(list.some((entry) => entry.filename === manual.filename));
  assert.ok(list.some((entry) => entry.filename === safety.filename));
  assert.equal((await readAutomaticState(f.config)).archives.length, 2);
  assert.equal(f.errors.length, 0);
});

test("retries failed attempts after five minutes without treating them as a successful period", async (context) => {
  const f = await fixture(context);
  let attempts = 0;
  const scheduler = f.engine({
    create: async (identity) => {
      if (++attempts === 1) throw new Error("Synthetic storage failure");
      return createBackup(f.config, f.connection, "automatic", identity);
    },
  });
  await scheduler.tick();
  assert.equal((await scheduler.read()).last_success, null);
  assert.equal((await scheduler.read()).last_failure?.stage, "backup");
  f.clock.value = new Date("2026-10-28T12:04:59.000Z");
  await scheduler.tick();
  assert.equal(attempts, 1);
  f.clock.value = new Date("2026-10-28T12:05:00.000Z");
  await scheduler.tick();
  assert.equal(attempts, 2);
  assert.ok((await scheduler.read()).last_success);
  assert.equal((await scheduler.read()).last_failure, null);
  assert.equal((await readAutomaticState(f.config)).pending, null);
  assert.equal((await f.catalog.list()).length, 1);
});

test("recovers a verified publication after interruption instead of creating another automatic backup", async (context) => {
  const f = await fixture(context);
  const identity = {
    id: randomUUID(),
    created_at: f.clock.value.toISOString(),
  };
  await writeAutomaticState(f.config, {
    ...emptyAutomaticState(),
    pending: identity,
  });
  await createBackup(f.config, f.connection, "automatic", identity);
  const scheduler = f.engine();
  await scheduler.tick();
  assert.equal(f.calls.length, 0);
  assert.equal((await scheduler.read()).last_success?.id, identity.id);
  assert.equal((await f.catalog.list()).length, 1);
  assert.equal((await readAutomaticState(f.config)).pending, null);
});

test("rejects a mismatched pending publication without overwriting or pruning the existing manual archive", async (context) => {
  const f = await fixture(context);
  const identity = {
    id: randomUUID(),
    created_at: f.clock.value.toISOString(),
  };
  await writeAutomaticState(f.config, {
    ...emptyAutomaticState(),
    pending: identity,
  });
  const manual = await createBackup(f.config, f.connection, "manual", identity);
  const scheduler = f.engine();
  await scheduler.tick();
  assert.equal((await scheduler.read()).last_success, null);
  f.clock.value = new Date("2026-10-28T12:05:00.000Z");
  await scheduler.tick();
  assert.equal(f.calls.length, 1);
  assert.ok(
    (await f.catalog.list()).some(
      (entry) =>
        entry.filename === manual.filename && entry.metadata?.kind === "manual",
    ),
  );
});

test("coalesces overlapping checks and joins accepted work during shutdown", async (context) => {
  const f = await fixture(context);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let attempts = 0;
  const scheduler = f.engine({
    create: async (identity) => {
      attempts++;
      entered();
      await gate;
      return createBackup(f.config, f.connection, "automatic", identity);
    },
  });
  const first = scheduler.tick();
  const second = scheduler.tick();
  assert.equal(first, second);
  await started;
  assert.equal((await scheduler.read()).running, true);
  const stopping = scheduler.stop();
  release();
  await Promise.all([first, second, stopping]);
  f.clock.value = new Date("2026-10-29T12:00:00.000Z");
  await scheduler.tick();
  assert.equal(attempts, 1);
  assert.ok((await scheduler.read()).last_success);
});

test("retries retention after downloads close without creating another backup for the same period", async (context) => {
  const f = await fixture(context);
  await f.settings.updateBackupPolicy({
    expected_revision: 1,
    policy: { frequency: "daily", retention: 1 },
  });
  const scheduler = f.engine();
  await scheduler.tick();
  const first = (await scheduler.read()).last_success!;
  const download = await f.catalog.download(first.filename);
  f.clock.value = new Date("2026-10-29T12:00:00.000Z");
  await scheduler.tick();
  assert.equal(f.calls.length, 2);
  assert.equal((await scheduler.read()).last_failure?.stage, "retention");
  assert.equal((await f.catalog.list()).length, 2);
  const closed = finished(download.stream).catch(() => {});
  download.stream.destroy();
  await closed;
  f.clock.value = new Date("2026-10-29T12:05:00.000Z");
  await scheduler.tick();
  assert.equal(f.calls.length, 2);
  assert.equal((await f.catalog.list()).length, 1);
  assert.equal((await scheduler.read()).last_failure, null);
  assert.equal((await scheduler.read()).retention_pending, false);
});

test("preserves invalid scheduler state and shares policy revisions with appearance writes", async (context) => {
  const f = await fixture(context);
  const results = await Promise.allSettled([
    f.settings.updateBackupPolicy({
      expected_revision: 1,
      policy: { frequency: "weekly", retention: 3 },
    }),
    f.settings.update({ expected_revision: 1, preferences: { theme: "dark" } }),
  ]);
  assert.equal(
    results.filter((entry) => entry.status === "fulfilled").length,
    1,
  );
  const current = await f.settings.readBackupPolicy();
  await f.settings.update({
    expected_revision: current.revision,
    preferences: { theme: "dark" },
  });
  assert.deepEqual(
    (await f.settings.readBackupPolicy()).policy,
    current.policy,
  );
  const path = join(f.config.configDirectory, ".automatic-backups.json");
  await writeFile(path, "damaged state");
  const scheduler = f.engine();
  await scheduler.tick();
  await assert.rejects(scheduler.read(), {
    code: "backup_schedule_unavailable",
  });
  assert.equal(await readFile(path, "utf8"), "damaged state");
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await readdir(f.config.backupsDirectory), []);
});

test("runs at startup and checks new periods while the runtime is open, retaining status across restarts", async (context) => {
  context.mock.timers.enable({
    apis: ["Date"],
    now: new Date("2026-10-28T12:00:00.000Z").getTime(),
  });
  const interval = globalThis.setInterval;
  context.mock.method(globalThis, "setInterval", ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) =>
    interval(
      callback,
      delay === 60_000 ? 1 : delay,
      ...args,
    )) as typeof setInterval);
  const root = await mkdtemp(join(tmpdir(), "inventory-automatic-runtime-"));
  const config = { ...loadConfig({ INVENTORY_DATA_DIR: root }), port: 0 };
  let runtime: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await mkdir(config.configDirectory, { recursive: true });
    await writeFile(
      config.settingsPath,
      JSON.stringify({
        version: 1,
        backups: { frequency: "daily", retention: 2 },
      }),
    );
    runtime = await startServer(config);
    const api = request(runtime.server);
    const initial = await api.get("/backups/schedule").expect(200);
    assert.equal(initial.headers["cache-control"], "no-store");
    assert.ok(initial.body.last_success);
    const first = initial.body.last_success.id;
    await api
      .put("/backups/schedule")
      .send({
        expected_revision: 0,
        policy: { frequency: "daily", retention: 0 },
      })
      .expect(422);
    context.mock.timers.setTime(new Date("2026-10-29T12:00:00.000Z").getTime());
    let completed = false;
    for (let check = 0; check < 100; check++) {
      const status = (await api.get("/backups/schedule").expect(200)).body;
      if (status.last_success?.id !== first && !status.running) {
        completed = true;
        break;
      }
    }
    assert.ok(
      completed,
      "The runtime interval must check a newly entered calendar period.",
    );
    assert.equal((await api.get("/backups")).body.length, 2);
    await runtime.stop();
    runtime = await startServer(config);
    assert.equal(
      (await request(runtime.server).get("/backups")).body.length,
      2,
    );
    const policy = (await request(runtime.server).get("/backups/schedule"))
      .body;
    await request(runtime.server)
      .put("/backups/schedule")
      .send({
        expected_revision: policy.revision,
        policy: { frequency: "disabled", retention: 2 },
      })
      .expect(200);
    await request(runtime.server)
      .put("/backups/schedule")
      .send({
        expected_revision: policy.revision,
        policy: { frequency: "daily", retention: 2 },
      })
      .expect(409);
  } finally {
    await runtime?.stop();
    await rm(root, { recursive: true, force: true });
  }
});
