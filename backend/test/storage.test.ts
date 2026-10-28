import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { initializeStorage, prepareStorage } from "../src/storage.js";
import { createSettingsService } from "../src/settings/service.js";

// The source and compiled entry points resolve the same repository root, independent of the caller's cwd.
test("uses the repository-local layout and resolves explicit root and database overrides independently", () => {
  const root = fileURLToPath(new URL("../../InventoryData", import.meta.url));
  const config = loadConfig({});
  assert.equal(config.storageRoot, root);
  assert.equal(config.databasePath, join(root, "data", "inventory.db"));
  assert.equal(config.attachmentsDirectory, join(root, "data", "attachments"));
  assert.equal(config.settingsPath, join(root, "config", "settings.json"));
  assert.equal(config.backupsDirectory, join(root, "backups"));
  assert.equal(config.logsDirectory, join(root, "logs"));
  assert.equal(config.tempDirectory, join(root, "temp"));
  const customRoot = join(tmpdir(), "custom-inventory-root");
  const databasePath = join(tmpdir(), "separate-db", "inventory.db");
  const custom = loadConfig({
    INVENTORY_DATA_DIR: customRoot,
    INVENTORY_DB_PATH: databasePath,
  });
  assert.equal(custom.storageRoot, customRoot);
  assert.equal(custom.databasePath, databasePath);
  assert.equal(
    custom.attachmentsDirectory,
    join(customRoot, "data", "attachments"),
  );
  assert.equal(
    custom.settingsPath,
    join(customRoot, "config", "settings.json"),
  );
  assert.equal(custom.tempDirectory, join(customRoot, "temp"));
  assert.equal(
    loadConfig({ INVENTORY_DATA_DIR: "~/inventory-test" }).storageRoot,
    join(homedir(), "inventory-test"),
  );
  assert.throws(
    () => loadConfig({ INVENTORY_DATA_DIR: "relative" }),
    /absolute/,
  );
});

test("resolves stored data and backup directories without changing fixed runtime locations or settings bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "inventory-storage-locations-"));
  const base = loadConfig({ INVENTORY_DATA_DIR: join(root, "application") });
  try {
    await mkdir(base.configDirectory, { recursive: true });
    const dataDirectory = join(root, "saved-data");
    const backupsDirectory = join(root, "saved-backups");
    const bytes = JSON.stringify({
      version: 1,
      storage: { dataDirectory, backupsDirectory },
    });
    await writeFile(base.settingsPath, bytes);
    const effective = await prepareStorage(base);
    assert.equal(effective.dataDirectory, dataDirectory);
    assert.equal(effective.databasePath, join(dataDirectory, "inventory.db"));
    assert.equal(
      effective.attachmentsDirectory,
      join(dataDirectory, "attachments"),
    );
    assert.equal(effective.backupsDirectory, backupsDirectory);
    for (const property of [
      "settingsPath",
      "configDirectory",
      "logsDirectory",
      "tempDirectory",
      "storageRoot",
    ] as const)
      assert.equal(effective[property], base[property]);
    assert.ok((await stat(effective.attachmentsDirectory)).isDirectory());
    assert.ok((await stat(backupsDirectory)).isDirectory());
    await assert.rejects(stat(base.dataDirectory), { code: "ENOENT" });
    await assert.rejects(stat(base.backupsDirectory), { code: "ENOENT" });
    assert.equal(await readFile(base.settingsPath, "utf8"), bytes);
    assert.deepEqual(await prepareStorage(base), effective);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps an explicit database override when settings select another data directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "inventory-storage-db-override-"));
  try {
    const application = join(root, "application");
    // An explicit override equal to the original default must remain explicit as well.
    for (const databasePath of [
      join(root, "sqlite", "custom.db"),
      join(application, "data", "inventory.db"),
    ]) {
      const base = loadConfig({
        INVENTORY_DATA_DIR: application,
        INVENTORY_DB_PATH: databasePath,
      });
      await mkdir(base.configDirectory, { recursive: true });
      await writeFile(
        base.settingsPath,
        JSON.stringify({
          version: 1,
          storage: { dataDirectory: join(root, "selected-data") },
        }),
      );
      const effective = await prepareStorage(base);
      assert.equal(effective.databasePath, databasePath);
      assert.equal(
        effective.attachmentsDirectory,
        join(root, "selected-data", "attachments"),
      );
      assert.equal(effective.backupsDirectory, base.backupsDirectory);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects invalid stored paths before creating data directories and preserves the file", async () => {
  const root = await mkdtemp(join(tmpdir(), "inventory-storage-invalid-"));
  const base = loadConfig({ INVENTORY_DATA_DIR: root });
  try {
    await mkdir(base.configDirectory, { recursive: true });
    for (const storage of [
      { dataDirectory: "relative" },
      { backupsDirectory: "" },
      { dataDirectory: "/bad\0path" },
      { extra: root },
    ]) {
      const bytes = JSON.stringify({ version: 1, storage });
      await writeFile(base.settingsPath, bytes);
      await assert.rejects(
        prepareStorage(base),
        (error: unknown) =>
          error instanceof Error &&
          "code" in error &&
          error.code === "application_settings_unavailable",
      );
      assert.equal(await readFile(base.settingsPath, "utf8"), bytes);
      await assert.rejects(stat(base.dataDirectory), { code: "ENOENT" });
      await assert.rejects(stat(base.backupsDirectory), { code: "ENOENT" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects overlapping storage directories including aliases and nonexistent descendants", async () => {
  const root = await mkdtemp(join(tmpdir(), "inventory-storage-overlap-"));
  const base = loadConfig({ INVENTORY_DATA_DIR: join(root, "application") });
  try {
    await mkdir(base.configDirectory, { recursive: true });
    const target = join(root, "data");
    const alias = join(root, "alias");
    await mkdir(target);
    await symlink(target, alias, "junction");
    for (const storage of [
      { dataDirectory: base.storageRoot },
      { dataDirectory: base.configDirectory },
      { dataDirectory: join(base.tempDirectory, "nested") },
      { backupsDirectory: base.dataDirectory },
      { backupsDirectory: base.storageRoot },
      { dataDirectory: target, backupsDirectory: join(target, "backups") },
      { dataDirectory: target, backupsDirectory: alias },
      ...(sep === "/"
        ? [
            {
              dataDirectory: target,
              backupsDirectory: join(target, "..\\backups"),
            },
          ]
        : []),
      {
        dataDirectory: join(target, "missing"),
        backupsDirectory: join(alias, "missing", "nested"),
      },
    ]) {
      const bytes = JSON.stringify({ version: 1, storage });
      await writeFile(base.settingsPath, bytes);
      await assert.rejects(prepareStorage(base), /separate directories/);
      assert.equal(await readFile(base.settingsPath, "utf8"), bytes);
    }
    // Similar names are separate directories, not descendants.
    await writeFile(
      base.settingsPath,
      JSON.stringify({
        version: 1,
        storage: {
          dataDirectory: target,
          backupsDirectory: `${target}-backups`,
        },
      }),
    );
    assert.equal(
      (await prepareStorage(base)).backupsDirectory,
      `${target}-backups`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preference writes preserve storage choices without exposing them in preference responses", async () => {
  const root = await mkdtemp(join(tmpdir(), "inventory-storage-preferences-"));
  const base = loadConfig({ INVENTORY_DATA_DIR: root });
  try {
    await initializeStorage(base);
    const storage = {
      dataDirectory: join(root, "selected-data"),
      backupsDirectory: join(root, "selected-backups"),
    };
    await writeFile(base.settingsPath, JSON.stringify({ version: 1, storage }));
    const settings = createSettingsService(base.settingsPath);
    assert.equal("storage" in (await settings.read()), false);
    const saved = await settings.update({
      expected_revision: 0,
      preferences: { language: "de" },
    });
    assert.equal("storage" in saved, false);
    assert.deepEqual(await settings.readStorage(), storage);
    assert.deepEqual(
      JSON.parse(await readFile(base.settingsPath, "utf8")).storage,
      storage,
    );
    await assert.rejects(
      settings.update({
        expected_revision: 1,
        preferences: { theme: "light" },
        storage,
      }),
      /Unrecognized key/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Repeated startup must preserve existing settings, databases and backup files rather than reinitializing them.
test("initializes every runtime directory while preserving existing settings, database bytes and backups", async () => {
  const root = await mkdtemp(join(tmpdir(), "inventory-storage-"));
  const config = loadConfig({ INVENTORY_DATA_DIR: root });
  try {
    await initializeStorage(config);
    for (const directory of [
      config.configDirectory,
      config.dataDirectory,
      config.attachmentsDirectory,
      config.backupsDirectory,
      config.logsDirectory,
      config.tempDirectory,
    ])
      assert.ok((await stat(directory)).isDirectory());
    assert.deepEqual(JSON.parse(await readFile(config.settingsPath, "utf8")), {
      version: 1,
    });
    const settings = '{"version":1,"test":"preserve exactly"}\n';
    await writeFile(config.settingsPath, settings);
    await writeFile(config.databasePath, "Existing database bytes");
    const backup = join(config.backupsDirectory, "keep.zip");
    await writeFile(backup, "Saved backup");
    await Promise.all([initializeStorage(config), initializeStorage(config)]);
    assert.equal(await readFile(config.settingsPath, "utf8"), settings);
    assert.equal(
      await readFile(config.databasePath, "utf8"),
      "Existing database bytes",
    );
    assert.equal(await readFile(backup, "utf8"), "Saved backup");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
