import { afterEach, expect, test, vi } from "vitest";
import {
  createBackup,
  downloadBackup,
  deleteBackup,
  listBackups,
} from "../../src/services/backups";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("forwards list cancellation and creates a durable backup without an abort signal", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => [] });
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await listBackups(controller.signal);
  await createBackup();
  expect(fetch.mock.calls[0]).toEqual([
    expect.stringMatching(/\/backups$/),
    expect.objectContaining({ signal: controller.signal }),
  ]);
  expect(fetch.mock.calls[1]).toEqual([
    expect.stringMatching(/\/backups$/),
    expect.objectContaining({ method: "POST" }),
  ]);
  expect(fetch.mock.calls[1]![1]).not.toHaveProperty("signal");
});

test("downloads the encoded filename natively without fetching or buffering the archive", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const clicked: HTMLAnchorElement[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
  downloadBackup("backup file.zip");
  expect(clicked).toHaveLength(1);
  expect(clicked[0]!.href).toMatch(/\/backups\/backup%20file.zip\/download$/);
  expect(clicked[0]!.download).toBe("backup file.zip");
  expect(clicked[0]!.target).toBe("_self");
  expect(clicked[0]!.isConnected).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

test("deletes the selected encoded filename without sending file content", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetch);
  await expect(deleteBackup("backup file.zip")).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledWith(
    expect.stringMatching(/\/backups\/backup%20file.zip$/),
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(fetch.mock.calls[0]![1]).not.toHaveProperty("body");
});
