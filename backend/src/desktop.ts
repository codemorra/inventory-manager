import { z } from "zod";
import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

// The ordinary Node backend communicates with the desktop host through Node IPC.
if (!process.send)
  throw new Error("The desktop backend requires a parent IPC channel.");
const send = process.send.bind(process);

const paths = z
  .strictObject({
    storageRoot: z.string(),
    tempDirectory: z.string(),
    frontendDirectory: z.string(),
  })
  .parse(JSON.parse(process.argv[2] ?? "null"));
const config = {
  ...loadConfig(
    {
      ...process.env,
      INVENTORY_DATA_DIR: paths.storageRoot,
      INVENTORY_FRONTEND_DIR: paths.frontendDirectory,
      INVENTORY_HOST: "127.0.0.1",
    },
    { tempDirectory: paths.tempDirectory },
  ),
  port: 0,
};
const startup = startServer(config);
let stopping: Promise<void> | undefined;

/** Drain the backend exactly once before the Node process exits. */
function stop() {
  stopping ??= startup
    .then((runtime) => runtime.stop())
    .then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
        console.error("Desktop backend shutdown failed:", error);
        process.exit(1);
      },
    );
}
process.on("message", (data: unknown) => {
  if (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    data.type === "stop"
  )
    stop();
});
process.once("disconnect", stop);
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
try {
  const runtime = await startup;
  const address = runtime.server.address();
  if (!address || typeof address === "string")
    throw new Error("The desktop server did not obtain a local port.");
  if (!stopping) send({ type: "ready", port: address.port });
} catch (error) {
  console.error("Desktop backend startup failed:", error);
  send(
    {
      type: "failed",
      message: error instanceof Error ? error.message : String(error),
    },
    () => {
      process.exitCode = 1;
      process.disconnect?.();
    },
  );
}
