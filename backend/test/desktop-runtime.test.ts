import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { acquireStorageLock } from "../src/storage-lock.js";

for (const shutdown of ["stop", "disconnect", "startup-failure"] as const) {
  test(
    `ordinary Node desktop backend drains and releases its root on ${shutdown}`,
    { timeout: 15000 },
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "inventory-desktop-node-"),
      );
      const storageRoot = join(directory, "storage");
      const frontendDirectory = join(directory, "frontend");
      await mkdir(frontendDirectory);
      await writeFile(
        join(frontendDirectory, "index.html"),
        "<!doctype html><title>Test</title>",
      );
      const child = fork(
        fileURLToPath(new URL("../src/desktop.ts", import.meta.url)),
        [
          JSON.stringify({
            storageRoot,
            frontendDirectory,
            tempDirectory: join(directory, "work"),
          }),
        ],
        {
          execArgv: ["--import", "tsx"],
          env: {
            ...process.env,
            INVENTORY_DB_PATH:
              shutdown === "startup-failure" ? frontendDirectory : undefined,
          },
          stdio: ["ignore", "ignore", "pipe", "ipc"],
        },
      );
      const exit = once(child, "exit", { signal: AbortSignal.timeout(10000) });
      void exit.catch(() => {});
      try {
        const [message] = await once(child, "message", {
          signal: AbortSignal.timeout(10000),
        });
        if (shutdown === "startup-failure") {
          assert.equal(message.type, "failed");
          assert.equal(typeof message.message, "string");
          assert.deepEqual(await exit, [1, null]);
        } else {
          assert.equal(message.type, "ready");
          const origin = `http://127.0.0.1:${message.port}`;
          assert.equal((await fetch(`${origin}/health`)).status, 200);
          assert.equal((await fetch(origin)).status, 200);
          if (shutdown === "stop") child.send({ type: "stop" });
          else child.disconnect();
          assert.deepEqual(await exit, [0, null]);
        }
        assert.match(
          await readFile(
            join(storageRoot, "logs/inventory-manager.log"),
            "utf8",
          ),
          shutdown === "startup-failure"
            ? /Application startup failed/
            : /Application stopped/,
        );
        const release = await acquireStorageLock(
          loadConfig({ INVENTORY_DATA_DIR: storageRoot }),
        );
        release();
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exit.catch(() => {});
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
}
