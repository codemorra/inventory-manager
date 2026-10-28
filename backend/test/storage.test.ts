import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { initializeStorage } from "../src/storage.js";

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
