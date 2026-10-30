import assert from "node:assert/strict";
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
import { test } from "node:test";
import {
  desktopBuildFormat,
  publishDesktopBuild,
} from "../../scripts/build-desktop.mjs";

test("desktop build selects onefile or onedir and rejects invalid arguments", () => {
  assert.equal(desktopBuildFormat([]), "onefile");
  assert.equal(desktopBuildFormat(["--dir"]), "onedir");
  assert.throws(
    () => desktopBuildFormat(["--other"]),
    /Expected no arguments or --dir/,
  );
  assert.throws(
    () => desktopBuildFormat(["--dir", "--dir"]),
    /Expected no arguments or --dir/,
  );
});

test("publishing replaces prior directory results and restores them on failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "inventory-build-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "build", "app");
  const destination = join(root, "dist", "app");
  await mkdir(source, { recursive: true });
  await mkdir(destination, { recursive: true });
  await writeFile(join(source, "new"), "new build");
  await writeFile(join(destination, "old"), "old build");
  await publishDesktopBuild(source, destination);
  assert.deepEqual(await readdir(destination), ["new"]);
  assert.equal(await readFile(join(destination, "new"), "utf8"), "new build");
  await assert.rejects(publishDesktopBuild(source, destination), {
    code: "ENOENT",
  });
  assert.equal(await readFile(join(destination, "new"), "utf8"), "new build");
  assert.deepEqual(await readdir(join(root, "dist")), ["app"]);
});

test("publishing a single file replaces the previous artifact", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "inventory-build-file-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "new.exe");
  const destination = join(root, "dist", "app.exe");
  await mkdir(join(root, "dist"));
  await writeFile(source, "new");
  await writeFile(destination, "old");
  await publishDesktopBuild(source, destination);
  assert.equal(await readFile(destination, "utf8"), "new");
});
