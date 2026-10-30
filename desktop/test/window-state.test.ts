import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readWindowState,
  visibleBounds,
  writeWindowState,
} from "../src/window-state.js";

test("a disconnected monitor or smaller work area cannot hide the restored window", () => {
  const area = { x: 0, y: 0, width: 1000, height: 700 };
  assert.deepEqual(
    visibleBounds({ x: 2500, y: -200, width: 1400, height: 900 }, [area]),
    area,
  );
  const second = { x: -1200, y: 0, width: 1200, height: 900 };
  const saved = { x: -1100, y: 100, width: 900, height: 700 };
  assert.deepEqual(visibleBounds(saved, [area, second]), saved);
});

test("window state survives restart without touching application settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "inventory-window-"));
  try {
    const path = join(directory, "window.json");
    assert.equal(readWindowState(path), undefined);
    const state = {
      version: 1 as const,
      maximized: true,
      bounds: { x: 10, y: 20, width: 900, height: 700 },
    };
    writeWindowState(path, state);
    assert.deepEqual(readWindowState(path), state);
    assert.equal(
      await readFile(path + ".tmp", "utf8").catch(() => "absent"),
      "absent",
    );
    await writeFile(path, "invalid");
    assert.equal(readWindowState(path), undefined);
    await writeFile(
      path,
      JSON.stringify({ ...state, bounds: { ...state.bounds, width: -1 } }),
    );
    assert.equal(readWindowState(path), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
