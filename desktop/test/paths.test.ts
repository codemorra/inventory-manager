import assert from "node:assert/strict";
import test from "node:test";
import { desktopPaths } from "../src/paths.js";

const linux = {
  packaged: true,
  platform: "linux" as const,
  homeDirectory: "/home/example",
  userTemporaryDirectory: "/tmp/example",
  repositoryRoot: "/code/inventory-manager",
  environment: {},
};

test("packaged Linux and Windows use the agreed user storage roots", () => {
  assert.equal(
    desktopPaths(linux).storageRoot,
    "/home/example/.local/share/inventory-manager",
  );
  assert.equal(
    desktopPaths({ ...linux, environment: { XDG_DATA_HOME: "/storage" } })
      .storageRoot,
    "/storage/inventory-manager",
  );
  const windows = {
    ...linux,
    platform: "win32" as const,
    homeDirectory: "C:\\Users\\Example",
    userTemporaryDirectory: "C:\\Users\\Example\\Temp",
    environment: { LOCALAPPDATA: "D:\\LocalData" },
  };
  assert.equal(
    desktopPaths(windows).storageRoot,
    "D:\\LocalData\\InventoryManager",
  );
  assert.equal(
    desktopPaths({ ...windows, environment: {} }).storageRoot,
    "C:\\Users\\Example\\AppData\\Local\\InventoryManager",
  );
});

test("repository mode is explicit and keeps repository data and temporary work", () => {
  const paths = desktopPaths({ ...linux, packaged: false });
  assert.equal(paths.storageRoot, "/code/inventory-manager/InventoryData");
  assert.equal(
    paths.tempDirectory,
    "/code/inventory-manager/InventoryData/temp",
  );
});

test("packaged temporary work stays outside saved data and is stable per application root", () => {
  const paths = desktopPaths(linux);
  assert.ok(paths.tempDirectory.startsWith("/tmp/example/inventory-manager/"));
  assert.deepEqual(desktopPaths(linux), paths);
  const custom = desktopPaths({
    ...linux,
    environment: { INVENTORY_DATA_DIR: "~/custom" },
  });
  assert.equal(custom.storageRoot, "/home/example/custom");
  assert.notEqual(custom.tempDirectory, paths.tempDirectory);
  assert.throws(
    () =>
      desktopPaths({
        ...linux,
        environment: { INVENTORY_DATA_DIR: "relative" },
      }),
    /absolute/,
  );
  assert.throws(
    () => desktopPaths({ ...linux, platform: "darwin" }),
    /Windows and Linux/,
  );
});

test("Windows keeps packaged temporary work separate and repository work below its selected root", () => {
  const windows = {
    packaged: true,
    platform: "win32" as const,
    homeDirectory: "C:\\Users\\Example",
    userTemporaryDirectory: "C:\\Users\\Example\\AppData\\Local\\Temp",
    repositoryRoot: "D:\\code\\inventory-manager",
    environment: { INVENTORY_DATA_DIR: "E:\\InventoryData" },
  };
  const packaged = desktopPaths(windows);
  assert.equal(packaged.storageRoot, "E:\\InventoryData");
  assert.ok(
    packaged.tempDirectory.startsWith(
      "C:\\Users\\Example\\AppData\\Local\\Temp\\inventory-manager\\",
    ),
  );
  const repository = desktopPaths({
    ...windows,
    packaged: false,
    environment: {},
  });
  assert.equal(
    repository.storageRoot,
    "D:\\code\\inventory-manager\\InventoryData",
  );
  assert.equal(
    repository.tempDirectory,
    "D:\\code\\inventory-manager\\InventoryData\\temp",
  );
});
