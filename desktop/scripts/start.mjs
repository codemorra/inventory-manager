import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { prepareRuntime } from "./prepare.mjs";

await prepareRuntime();
const environment = { ...process.env };
environment.INVENTORY_NODE_EXECUTABLE = process.execPath;
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(
  electron,
  [fileURLToPath(new URL("../", import.meta.url))],
  {
    env: environment,
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => child.kill(signal));
child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
