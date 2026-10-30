import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { verifyPackageFiles } from "../scripts/package-content.mjs";

test("packaged runtime files and dependency licenses must be present and unchanged", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "inventory-package-files-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  const packaged = join(directory, "packaged");
  for (const root of [source, packaged]) {
    await mkdir(join(root, "node_modules/example"), { recursive: true });
    await writeFile(join(root, "node_modules/example/LICENSE"), "license");
    await writeFile(join(root, "node_modules/example/index.js"), "module");
  }
  await verifyPackageFiles(source, packaged);
  await writeFile(join(packaged, "node_modules/example/LICENSE"), "changed");
  await assert.rejects(verifyPackageFiles(source, packaged), /differs/);
  await rm(join(packaged, "node_modules/example/LICENSE"));
  await assert.rejects(verifyPackageFiles(source, packaged), {
    code: "ENOENT",
  });
});
