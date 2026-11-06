import assert from "node:assert/strict";
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import request from "supertest";
import { createSettingsService } from "../src/settings/service.js";
import { defaultPreferences } from "../src/settings/validation.js";
import { initializeStorage } from "../src/storage.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db/connection.js";
import { createServices } from "../src/services.js";
import { createApp } from "../src/app.js";
import { startServer } from "../src/server.js";

/** Compose real file-backed settings and HTTP routes with isolated data only. */
async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "inventory-settings-test-"));
  const config = loadConfig({ INVENTORY_DATA_DIR: root });
  await initializeStorage(config);
  const connection = openDatabase(":memory:");
  const services = createServices(connection.db, {
    directory: config.attachmentsDirectory,
    tempDirectory: config.tempDirectory,
    settingsPath: config.settingsPath,
  });
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
    await rm(root, { recursive: true, force: true });
  });
  return { root, config, services, settings: services.settings!, api, errors };
}
const code = (expected: string) => (error: unknown) =>
  error instanceof Error && "code" in error && error.code === expected;

// Exercise real handles across independent scheduler, preferences and storage callers.
test("saves settings while independent services continuously read the shared file", async (context) => {
  const f = await fixture(context);
  const reader = createSettingsService(f.config.settingsPath);
  const writer = createSettingsService(f.config.settingsPath);
  let reading = true;
  const readers = Array.from({ length: 3 }, async () => {
    while (reading) {
      await Promise.all([
        reader.read(),
        reader.readBackupPolicy(),
        reader.readStorage(),
        reader.readStorageState(),
      ]);
    }
  });
  const writes = (async () => {
    try {
      for (let index = 0; index < 10; index++) {
        const revision = index * 3;
        await writer.update({
          expected_revision: revision,
          preferences: { theme: "dark", language: "de" },
        });
        await writer.updateBackupPolicy({
          expected_revision: revision + 1,
          policy: { frequency: "daily", retention: 2 },
        });
        await writer.updateStorage(revision + 2, async (storage) => ({
          ...storage,
          moveFailed: true,
        }));
      }
    } finally {
      reading = false;
    }
  })();
  // Drain every reader before reporting a failure or removing the fixture.
  const results = await Promise.allSettled([...readers, writes]);
  for (const result of results) {
    if (result.status === "rejected") throw result.reason;
  }
  assert.equal((await reader.read()).revision, 30);
  assert.equal((await reader.read()).preferences.theme, "dark");
  assert.equal((await reader.read()).preferences.language, "de");
  assert.deepEqual((await reader.readBackupPolicy()).policy, {
    frequency: "daily",
    retention: 2,
  });
  assert.deepEqual(await reader.readStorage(), { moveFailed: true });
  assert.deepEqual(await readdir(f.config.configDirectory), ["settings.json"]);
});

// An external handle is outside the service queue: Windows must report the real
// replacement failure, preserve the original, clean the temporary and recover.
test("handles an externally opened settings destination without losing data or blocking later writes", async (context) => {
  const f = await fixture(context);
  const before = await readFile(f.config.settingsPath, "utf8");
  const externalReader = await open(f.config.settingsPath, "r");
  try {
    const update = f.settings.update({
      expected_revision: 0,
      preferences: { theme: "dark" },
    });
    if (process.platform === "win32") {
      await assert.rejects(update, code("EPERM"));
      assert.equal(await readFile(f.config.settingsPath, "utf8"), before);
      assert.equal((await f.settings.read()).revision, 0);
    } else {
      // POSIX permits replacing a destination while an old read handle is open.
      assert.equal((await update).revision, 1);
    }
    assert.deepEqual(await readdir(f.config.configDirectory), [
      "settings.json",
    ]);
  } finally {
    await externalReader.close();
  }
  const revision = (await f.settings.read()).revision;
  const saved = await f.settings.update({
    expected_revision: revision,
    preferences: { theme: "light" },
  });
  assert.equal(saved.revision, revision + 1);
  assert.equal(saved.preferences.theme, "light");
  assert.deepEqual(
    await createSettingsService(f.config.settingsPath).read(),
    saved,
  );
});

// Placeholder settings acquire defaults without being rewritten merely by reading them.
test("reads effective defaults and persists partial preferences across service reconstruction", async (context) => {
  const f = await fixture(context);
  const initialBytes = await readFile(f.config.settingsPath, "utf8");
  const initial = await f.settings.read();
  assert.deepEqual(initial, {
    version: 1,
    revision: 0,
    preferences: defaultPreferences,
  });
  assert.equal(await readFile(f.config.settingsPath, "utf8"), initialBytes);
  const saved = await f.settings.update({
    expected_revision: 0,
    preferences: { theme: "dark", language: "de" },
  });
  assert.equal(saved.revision, 1);
  assert.deepEqual(saved.preferences, {
    ...defaultPreferences,
    theme: "dark",
    language: "de",
  });
  assert.deepEqual(
    await createSettingsService(f.config.settingsPath).read(),
    saved,
  );
  const disk = JSON.parse(await readFile(f.config.settingsPath, "utf8"));
  assert.deepEqual(disk.preferences, { theme: "dark", language: "de" });
  assert.deepEqual(await readdir(f.config.configDirectory), ["settings.json"]);
});

// Shared path serialization prevents two concurrent backend callers from both accepting the same revision.
test("rejects stale concurrent updates without losing existing preferences", async (context) => {
  const f = await fixture(context);
  const other = createSettingsService(f.config.settingsPath);
  const results = await Promise.allSettled([
    f.settings.update({
      expected_revision: 0,
      preferences: { accent: "blue" },
    }),
    other.update({ expected_revision: 0, preferences: { theme: "dark" } }),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const rejected = results.find((result) => result.status === "rejected")!;
  assert.ok(
    rejected.status === "rejected" &&
      code("application_settings_conflict")(rejected.reason),
  );
  const latest = await f.settings.read();
  const updated = await other.update({
    expected_revision: latest.revision,
    preferences: { attachmentWarnings: "hide" },
  });
  assert.equal(updated.preferences.accent, latest.preferences.accent);
  assert.equal(updated.preferences.theme, latest.preferences.theme);
  assert.equal(updated.preferences.attachmentWarnings, "hide");
});

// Unsupported/corrupt files remain intact and never become silently reset preferences.
test("preserves invalid files and recovers the write queue after an explicit file correction", async (context) => {
  const f = await fixture(context);
  for (const contents of [
    '{"version":2}',
    '{"version":1,"surprise":true}',
    '{"version":1,"preferences":{"theme":"unknown"}}',
    "{",
    "x".repeat(65537),
  ]) {
    await writeFile(f.config.settingsPath, contents);
    await assert.rejects(
      f.settings.read(),
      code("application_settings_unavailable"),
    );
    await assert.rejects(
      f.settings.update({
        expected_revision: 0,
        preferences: { accent: "blue" },
      }),
      code("application_settings_unavailable"),
    );
    assert.equal(await readFile(f.config.settingsPath, "utf8"), contents);
  }
  await writeFile(f.config.settingsPath, '{"version":1}');
  assert.equal(
    (
      await f.settings.update({
        expected_revision: 0,
        preferences: { accent: "orange" },
      })
    ).preferences.accent,
    "orange",
  );
});

// Public writes are revisioned, typed and cannot select paths or inject settings outside the supported schema.
test("validates public settings writes and returns structured conflicts and no-store responses", async (context) => {
  const f = await fixture(context);
  const read = await f.api.get("/application-settings").expect(200);
  assert.equal(read.headers["cache-control"], "no-store");
  assert.equal(read.body.settingsPath, undefined);
  for (const body of [
    { preferences: { theme: "dark" } },
    { expected_revision: false, preferences: { theme: "dark" } },
    { expected_revision: 0, preferences: { accent: "pink" } },
    { expected_revision: 0, preferences: { accent: "rose" } },
    { expected_revision: 0, preferences: { accent: "yellow" } },
    { expected_revision: 0, preferences: { accent: "teal" } },
    { expected_revision: 0, preferences: { accent: "brand" } },
    { expected_revision: 0, preferences: {} },
    { expected_revision: 0, preferences: { theme: "dark" }, path: "/other" },
  ])
    await f.api.patch("/application-settings").send(body).expect(422);
  const result = await f.api
    .patch("/application-settings")
    .send({ expected_revision: 0, preferences: { theme: "dark" } })
    .expect(200);
  assert.equal(result.body.revision, 1);
  const conflict = await f.api
    .patch("/application-settings")
    .send({ expected_revision: 0, preferences: { theme: "light" } })
    .expect(409);
  assert.equal(conflict.body.detail.code, "application_settings_conflict");
  assert.deepEqual(f.errors, []);
});

// Exhausted counters reject further writes rather than overflowing or replacing the file.
test("preserves files on revision exhaustion and surfaces invalid settings as HTTP 503", async (context) => {
  const f = await fixture(context);
  const contents = JSON.stringify({
    version: 1,
    revision: Number.MAX_SAFE_INTEGER,
  });
  await writeFile(f.config.settingsPath, contents);
  await assert.rejects(
    f.settings.update({
      expected_revision: Number.MAX_SAFE_INTEGER,
      preferences: { language: "de" },
    }),
    code("application_settings_conflict"),
  );
  assert.equal(await readFile(f.config.settingsPath, "utf8"), contents);
  await writeFile(f.config.settingsPath, "invalid");
  const result = await f.api.get("/application-settings").expect(503);
  assert.equal(result.body.detail.code, "application_settings_unavailable");
});

// A bad configuration document must stop startup without exposing a fresh/default settings state.
test("refuses to listen with an invalid settings file and preserves its contents", async (context) => {
  const f = await fixture(context);
  await writeFile(f.config.settingsPath, '{"version":42}');
  await assert.rejects(
    startServer({ ...f.config, port: 0 }),
    code("application_settings_unavailable"),
  );
  assert.equal(await readFile(f.config.settingsPath, "utf8"), '{"version":42}');
});

test("persists all supported accent palettes through HTTP and settings reconstruction", async (context) => {
  const f = await fixture(context);
  const accents = [
    "turquoise",
    "cyan",
    "blue",
    "purple",
    "orange",
    "green",
    "slate",
  ];
  let revision = 0;
  for (const accent of accents) {
    const saved = await f.api
      .patch("/application-settings")
      .send({
        expected_revision: revision,
        preferences: { accent },
      })
      .expect(200);
    revision = saved.body.revision;
    assert.equal(saved.body.preferences.accent, accent);
    const reconstructed = await createSettingsService(
      f.config.settingsPath,
    ).read();
    assert.equal(reconstructed.preferences.accent, accent);
    assert.equal(reconstructed.revision, revision);
  }
  assert.deepEqual(f.errors, []);
});

test("defaults missing and retired accents to the original palette without rewriting existing settings", async (context) => {
  const f = await fixture(context);
  for (const accent of [undefined, "rose", "teal"]) {
    const bytes = JSON.stringify({
      version: 1,
      revision: 4,
      preferences: {
        language: "de",
        theme: "dark",
        ...(accent ? { accent } : {}),
      },
    });
    await writeFile(f.config.settingsPath, bytes);
    const settings = await f.settings.read();
    assert.equal(settings.preferences.accent, "turquoise");
    assert.equal(settings.preferences.language, "de");
    assert.equal(settings.preferences.theme, "dark");
    assert.equal(settings.revision, 4);
    assert.equal(await readFile(f.config.settingsPath, "utf8"), bytes);
  }
});

// Preserve existing selections while using the canonical name for future writes.
test("reads brand as turquoise and normalizes it on the next settings write", async (context) => {
  const f = await fixture(context);
  const bytes = JSON.stringify({
    version: 1,
    revision: 4,
    preferences: { accent: "brand", language: "de" },
  });
  await writeFile(f.config.settingsPath, bytes);
  const read = await f.api.get("/application-settings").expect(200);
  assert.equal(read.body.preferences.accent, "turquoise");
  assert.equal(read.body.revision, 4);
  assert.equal(await readFile(f.config.settingsPath, "utf8"), bytes);
  const saved = await f.api
    .patch("/application-settings")
    .send({
      expected_revision: 4,
      preferences: { theme: "dark" },
    })
    .expect(200);
  assert.equal(saved.body.preferences.accent, "turquoise");
  assert.equal(saved.body.preferences.language, "de");
  const document = JSON.parse(await readFile(f.config.settingsPath, "utf8"));
  assert.equal(document.preferences.accent, "turquoise");
});
