import { readFileSync, writeFileSync, renameSync } from "node:fs";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface WindowState {
  version: 1;
  bounds: Bounds;
  maximized: boolean;
}

/**
 * Read optional window preferences independently of application settings revisions.
 * @param path The desktop window-state file.
 * @returns Valid saved state, or undefined when absent or malformed.
 * @throws {Error} When an existing file cannot be read for another reason.
 */
export function readWindowState(path: string): WindowState | undefined {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    )
      return;
    throw error;
  }
  if (!value || typeof value !== "object") return;
  const state = value as Partial<WindowState>;
  const bounds = state.bounds;
  if (
    state.version !== 1 ||
    typeof state.maximized !== "boolean" ||
    !bounds ||
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(
      Number.isSafeInteger,
    ) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    return;
  return state as WindowState;
}

/**
 * Keep the restored window inside a connected display's usable area.
 * @param saved Previously saved normal bounds.
 * @param areas Current display work areas, with the primary display first.
 * @returns Visible bounds clamped to an available display.
 */
export function visibleBounds(
  saved: Bounds | undefined,
  areas: Bounds[],
): Bounds {
  const primary = areas[0]!;
  const area =
    (saved &&
      areas.find(
        (area) =>
          saved.x < area.x + area.width &&
          saved.x + saved.width > area.x &&
          saved.y < area.y + area.height &&
          saved.y + saved.height > area.y,
      )) ||
    primary;
  const width = Math.min(saved?.width ?? 1200, area.width);
  const height = Math.min(saved?.height ?? 800, area.height);
  return {
    width,
    height,
    x: saved
      ? Math.max(area.x, Math.min(saved.x, area.x + area.width - width))
      : area.x + Math.round((area.width - width) / 2),
    y: saved
      ? Math.max(area.y, Math.min(saved.y, area.y + area.height - height))
      : area.y + Math.round((area.height - height) / 2),
  };
}

/**
 * Replace only desktop window preferences through a private sibling file.
 * @param path The window-state destination in the fixed configuration directory.
 * @param state The last normal bounds and current maximization state.
 * @throws {Error} When writing or replacing the state file fails.
 */
export function writeWindowState(path: string, state: WindowState) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state)}\n`, {
    mode: 0o600,
    flush: true,
  });
  renameSync(temporary, path);
}
