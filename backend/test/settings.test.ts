import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
    { expected_revision: 0, preferences: { accent: "green" } },
    { expected_revision: 0, preferences: { accent: "teal" } },
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
  const accents = ["brand", "cyan", "blue", "purple", "orange", "slate"];
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
  for (const accent of [undefined, "rose", "green", "teal"]) {
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
    assert.equal(settings.preferences.accent, "brand");
    assert.equal(settings.preferences.language, "de");
    assert.equal(settings.preferences.theme, "dark");
    assert.equal(settings.revision, 4);
    assert.equal(await readFile(f.config.settingsPath, "utf8"), bytes);
  }
});
