import type { EventEmitter } from "node:events";

export interface BackendProcess extends EventEmitter {
  send(
    message: { type: "stop" },
    callback: (error: Error | null) => void,
  ): boolean;
}

/**
 * Coordinate readiness and graceful shutdown over the ordinary Node IPC channel.
 * @param child The freshly launched Node backend process.
 * @param onUnexpectedExit Report a backend that exits after startup without a stop request.
 * @returns A readiness promise and an idempotent stop operation waiting for process exit.
 */
export function connectBackend(
  child: BackendProcess,
  onUnexpectedExit: (error: Error) => void,
) {
  let stopping = false;
  let spawned = false;
  let exited = false;
  let exitCode: number | null | undefined;
  let ready = false;
  let stopPromise: Promise<void> | undefined;
  let resolveReady: (origin: string) => void;
  let rejectReady: (error: Error) => void;
  const origin = new Promise<string>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // A stop during startup still observes the readiness failure through the public promise.
  void origin.catch(() => {});
  child.once("spawn", () => {
    spawned = true;
  });
  child.on("error", (error: Error) => {
    if (!spawned) {
      exited = true;
      exitCode = null;
    }
    rejectReady(error);
    if (ready && !stopping) onUnexpectedExit(error);
  });
  child.on("message", (message: unknown) => {
    if (!message || typeof message !== "object" || !("type" in message)) return;
    if (
      message.type === "ready" &&
      "port" in message &&
      Number.isInteger(message.port) &&
      Number(message.port) > 0 &&
      Number(message.port) <= 65535
    ) {
      ready = true;
      resolveReady(`http://127.0.0.1:${Number(message.port)}`);
    } else if (message.type === "failed") {
      rejectReady(
        new Error(
          "message" in message
            ? String(message.message)
            : "Backend startup failed.",
        ),
      );
    }
  });
  child.once("exit", (code: number | null) => {
    exited = true;
    exitCode = code;
    const error = new Error(`The local backend exited (${code}).`);
    if (!ready) rejectReady(error);
    else if (!stopping) onUnexpectedExit(error);
  });
  return {
    origin,
    /**
     * Request a graceful stop once and wait for the child to exit.
     * @returns Completion after process exit; rejects on an unsuccessful shutdown.
     */
    stop() {
      stopPromise ??= new Promise<void>((resolve, reject) => {
        stopping = true;
        if (exited) {
          if (exitCode === 0) resolve();
          else reject(new Error(`The local backend exited (${exitCode}).`));
          return;
        }
        child.once("exit", (code: number | null) => {
          if (code === 0) resolve();
          else reject(new Error(`Backend shutdown failed (${code}).`));
        });
        child.send({ type: "stop" }, (error) => {
          if (error) reject(error);
        });
      });
      return stopPromise;
    },
  };
}
