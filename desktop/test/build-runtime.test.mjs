import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  downloadNode,
  nodeDistribution,
  nodeVersion,
} from "../scripts/build-runtime.mjs";

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
