import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const directory = await mkdtemp(join(tmpdir(), "inventory-electron-"));
try {
  for (const phase of ["seed", "verify"]) {
    await new Promise((resolve, reject) => {
      const environment = {
        ...process.env,
        INVENTORY_DATA_DIR: directory,
        INVENTORY_DESKTOP_SMOKE_PHASE: phase,
        INVENTORY_NODE_EXECUTABLE: process.execPath,
      };
      delete environment.INVENTORY_DB_PATH;
      delete environment.ELECTRON_RUN_AS_NODE;
      const child = spawn(
        electron,
        [fileURLToPath(new URL("../test/electron-smoke.mjs", import.meta.url))],
        {
          env: environment,
          stdio: "inherit",
        },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Electron smoke test failed (${code}).`)),
      );
    });
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
