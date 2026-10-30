import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  downloadNode,
  extractNode,
  nodeDistribution,
  nodeVersion,
} from "../scripts/build-runtime.mjs";

function runPowerShell(command, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      { env: { ...process.env, ...environment }, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`PowerShell command failed (${signal ?? code}).`));
    });
  });
}

test("build runtime selects only the supported platform distributions", () => {
  const linux = nodeDistribution("linux", "x64");
  const windows = nodeDistribution("win32", "x64");
  assert.equal(linux.archive, `node-${nodeVersion}-linux-x64.tar.gz`);
  assert.equal(linux.executable, "bin/node");
  assert.equal(linux.npmDirectory, "lib/node_modules/npm");
  assert.equal(windows.archive, `node-${nodeVersion}-win-x64.zip`);
  assert.equal(windows.executable, "node.exe");
  assert.equal(windows.npmDirectory, "node_modules/npm");
  for (const distribution of [linux, windows])
    assert.match(distribution.checksum, /^[a-f0-9]{64}$/);
  assert.throws(
    () => nodeDistribution("darwin", "x64"),
    /x64 Linux or Windows/,
  );
  assert.throws(
    () => nodeDistribution("linux", "arm64"),
    /x64 Linux or Windows/,
  );
});

test(
  "Windows Node archives are extracted into the runtime layout",
  { skip: process.platform !== "win32" },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), "runtime-zip-test-"));
    try {
      const distribution = nodeDistribution("win32", "x64");
      const prefix = distribution.archive.replace(/\.zip$/, "");
      const fixtureRoot = join(temporary, "input");
      const source = join(fixtureRoot, prefix);
      const archive = join(temporary, distribution.archive);
      const destination = join(temporary, "extracted");
      await mkdir(join(source, "node_modules", "npm", "bin"), {
        recursive: true,
      });
      await writeFile(join(source, "node.exe"), "node fixture");
      await writeFile(join(source, "LICENSE"), "license fixture");
      await writeFile(
        join(source, "node_modules", "npm", "bin", "npm-cli.js"),
        "npm fixture",
      );
      await mkdir(destination);
      await runPowerShell(
        'Compress-Archive -Path "$env:NODE_FIXTURE_ROOT\\*" -DestinationPath $env:NODE_FIXTURE_ARCHIVE',
        {
          NODE_FIXTURE_ROOT: fixtureRoot,
          NODE_FIXTURE_ARCHIVE: archive,
        },
      );

      await extractNode(archive, destination, distribution);

      assert.equal(
        await readFile(join(destination, "node.exe"), "utf8"),
        "node fixture",
      );
      assert.equal(
        await readFile(join(destination, "LICENSE"), "utf8"),
        "license fixture",
      );
      assert.equal(
        await readFile(
          join(destination, "node_modules", "npm", "bin", "npm-cli.js"),
          "utf8",
        ),
        "npm fixture",
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

test("Node downloads are checked against the pinned checksum", async () => {
  const bytes = Buffer.from("test archive");
  const distribution = {
    archive: "test.tar.gz",
    checksum: createHash("sha256").update(bytes).digest("hex"),
  };
  let requestedUrl;
  const request = async (url) => {
    requestedUrl = url;
    return new Response(bytes);
  };
  assert.deepEqual(
    await downloadNode(distribution, request),
    new Uint8Array(bytes),
  );
  assert.equal(
    requestedUrl,
    `https://nodejs.org/dist/${nodeVersion}/test.tar.gz`,
  );
  await assert.rejects(
    downloadNode({ ...distribution, checksum: "0".repeat(64) }, request),
    /checksum mismatch/,
  );
  await assert.rejects(
    downloadNode(distribution, async () => new Response(null, { status: 404 })),
    /HTTP 404/,
  );
  await assert.rejects(
    downloadNode(distribution, async () => {
      throw new Error("network unavailable");
    }),
    /network unavailable/,
  );
});
