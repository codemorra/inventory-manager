import { createHash } from "node:crypto";
import { posix, win32 } from "node:path";

export interface DesktopPaths {
  storageRoot: string;
  tempDirectory: string;
}

/**
 * Resolve explicitly selected desktop defaults without touching application data.
 * @param input Runtime mode, host paths and optional storage overrides.
 * @returns The fixed application root and its runtime-specific temporary directory.
 * @throws {Error} For unsupported platforms or relative storage paths.
 */
export function desktopPaths(input: {
  packaged: boolean;
  platform: NodeJS.Platform;
  homeDirectory: string;
  userTemporaryDirectory: string;
  repositoryRoot: string;
  environment: NodeJS.ProcessEnv;
}): DesktopPaths {
  const { environment, platform, homeDirectory, packaged } = input;
  if (platform !== "win32" && platform !== "linux")
    throw new Error("The desktop application supports Windows and Linux.");
  const path = platform === "win32" ? win32 : posix;
  const dataHome =
    platform === "win32"
      ? environment.LOCALAPPDATA || path.join(homeDirectory, "AppData", "Local")
      : environment.XDG_DATA_HOME ||
        path.join(homeDirectory, ".local", "share");
  const defaultRoot = packaged
    ? path.join(
        dataHome,
        platform === "win32" ? "InventoryManager" : "inventory-manager",
      )
    : path.join(input.repositoryRoot, "InventoryData");
  const override = environment.INVENTORY_DATA_DIR;
  const selected =
    override === "~"
      ? homeDirectory
      : override?.startsWith("~/")
        ? path.join(homeDirectory, override.slice(2))
        : override || defaultRoot;
  if (!path.isAbsolute(selected) || selected.includes("\0"))
    throw new Error("The application storage root must be an absolute path.");
  const storageRoot = path.normalize(selected);
  // Separate temporary workspaces when the same user selects different application roots.
  const identity = createHash("sha256")
    .update(storageRoot)
    .digest("hex")
    .slice(0, 16);
  const tempDirectory = packaged
    ? path.join(input.userTemporaryDirectory, "inventory-manager", identity)
    : path.join(storageRoot, "temp");
  return { storageRoot, tempDirectory };
}
