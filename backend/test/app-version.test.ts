import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import express from "express";
import request from "supertest";
import { APP_VERSION } from "../src/generated/app-version.js";
import { docsRoutes } from "../src/routes/docs.js";

const execute = promisify(execFile);

test("version generation uses its repository root and preserves unchanged modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inventory-version-"));
  try {
    await mkdir(join(directory, "scripts"));
    const script = join(directory, "scripts/generate-app-version.mjs");
    await copyFile(
      new URL("../../scripts/generate-app-version.mjs", import.meta.url),
      script,
    );
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ version: "2.3.4" }),
    );
    await execute(process.execPath, [script], { cwd: tmpdir() });
    const frontend = join(directory, "frontend/src/generated/app-version.ts");
    const backend = join(directory, "backend/src/generated/app-version.ts");
    const source = await readFile(frontend, "utf8");
    assert.match(source, /APP_VERSION = "2\.3\.4"/);
    assert.equal(await readFile(backend, "utf8"), source);
    const modified = (await stat(frontend)).mtimeMs;
    await execute(process.execPath, [script, "frontend"]);
    assert.equal((await stat(frontend)).mtimeMs, modified);
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ version: "3.0.0" }),
    );
    await execute(process.execPath, [script, "frontend"]);
    assert.match(await readFile(frontend, "utf8"), /APP_VERSION = "3\.0\.0"/);
    assert.equal(await readFile(backend, "utf8"), source);
    await execute(process.execPath, [script, "desktop"]);
    assert.match(
      await readFile(
        join(directory, "desktop/src/generated/app-version.ts"),
        "utf8",
      ),
      /APP_VERSION = "3\.0\.0"/,
    );
    await assert.rejects(execute(process.execPath, [script, "unknown"]));
    await writeFile(join(directory, "package.json"), "{}");
    await assert.rejects(execute(process.execPath, [script]));
    assert.equal(await readFile(backend, "utf8"), source);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("served OpenAPI uses the generated application version", async () => {
  const app = express().use(docsRoutes());
  const response = await request(app).get("/openapi.json").expect(200);
  const root = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  );
  assert.equal(APP_VERSION, root.version);
  assert.equal(response.body.info.version, root.version);
});
