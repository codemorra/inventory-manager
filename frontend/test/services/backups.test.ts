import { afterEach, expect, test, vi } from "vitest";
import {
  createBackup,
  downloadBackup,
  deleteBackup,
  listBackups,
  prepareBackupRestore,
  confirmBackupRestore,
  readBackupRestore,
  discardBackupRestore,
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

test("prepares stored and external restore sources and retains the exact confirmation identity", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  const file = new File(["zip"], "source.zip");
  const controller = new AbortController();
  await prepareBackupRestore("stored.zip", controller.signal);
  await prepareBackupRestore(file, controller.signal);
  await confirmBackupRestore("token/id");
  await readBackupRestore("token/id");
  await discardBackupRestore("token/id");
  expect(fetch.mock.calls[0]![1]).toMatchObject({
    body: JSON.stringify({ filename: "stored.zip" }),
    signal: controller.signal,
  });
  expect(fetch.mock.calls[1]![1]).toMatchObject({
    body: file,
    signal: controller.signal,
    headers: { "Content-Type": "application/zip" },
  });
  expect(fetch.mock.calls.slice(2).map(([url]) => url)).toEqual([
    expect.stringMatching(/\/backup-restores\/token%2Fid\/confirm$/),
    expect.stringMatching(/\/backup-restores\/token%2Fid$/),
    expect.stringMatching(/\/backup-restores\/token%2Fid$/),
  ]);
  expect(fetch.mock.calls[2]![1]).toMatchObject({ method: "POST" });
  expect(fetch.mock.calls[2]![1]).not.toHaveProperty("signal");
  expect(fetch.mock.calls[4]![1]).toMatchObject({ method: "DELETE" });
});
