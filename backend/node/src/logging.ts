import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { createStream } from "rotating-file-stream";
import type { AppConfig } from "./config.js";

// Define log priorities and levels for the application.
const priorities = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50,
};
type LogLevel = keyof typeof priorities;

// Logger interface and creation function for the application.
export interface Logger {
  info(message: string): void;
  error(message: string, error?: unknown): void;
  close(): Promise<void>;
}

/**
 * Create and configure a logger for the application.
 * @param config The application configuration containing the logs directory and log level.
 * @returns A promise that resolves to the configured logger.
 */
export async function createLogger(
  config: Pick<AppConfig, "logsDirectory" | "logLevel">,
): Promise<Logger> {
  await mkdir(config.logsDirectory, { recursive: true });
  const stream = createStream("inventory-manager.log", {
    path: config.logsDirectory,
    size: "1000000B",
    rotate: 5,
    encoding: "utf8",
  });
  await once(stream, "open");
  stream.on("error", (error: Error) => {
    console.error("Unable to write the application log:", error);
  });

  /**
   * Write a log message to the stream if the level is above the configured threshold.
   * @param level The log level of the message.
   * @param message The log message.
   * @param error An optional error object to include in the log.
   */
  function write(level: LogLevel, message: string, error?: unknown) {
    if (priorities[level] < priorities[config.logLevel]) return;
    const details =
      error instanceof Error
        ? ` ${error.stack ?? error.message}`
        : error === undefined
          ? ""
          : ` ${String(error)}`;
    stream.write(
      `${new Date().toISOString()} ${level} inventory_manager ${message}${details}\n`,
    );
  }

  let closing: Promise<void> | undefined;
  return {
    info: (message) => write("INFO", message),
    error: (message, error) => write("ERROR", message, error),
    close() {
      closing ??= (async () => {
        const completion = finished(stream);
        stream.end();
        await completion;
      })();
      return closing;
    },
  };
}
