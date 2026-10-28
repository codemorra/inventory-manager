import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/** Resolve an absolute storage path, including a leading home-directory shorthand. */
export function storagePath(value: string): string {
  const expanded =
    value === "~"
      ? homedir()
      : value.startsWith("~/")
        ? join(homedir(), value.slice(2))
        : value;
  if (!isAbsolute(expanded) || expanded.includes("\0")) {
    throw new Error(
      "Inventory storage paths must be absolute (or start with ~/).",
    );
  }
  return resolve(expanded);
}
