import { afterEach, expect, test, vi } from "vitest";
import * as archives from "../../src/services/inventoryArchives";
import {
  archiveExport,
  archivePreview,
  importedInventory,
} from "../helpers/inventoryArchives";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Original archive bodies and AbortSignal pass through unchanged; no FileReader/Blob buffering.
test("streams the original File and forwards preview cancellation", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => archivePreview,
  });
  vi.stubGlobal("fetch", fetch);
  const file = new File(["zip"], "Prüfung.zip");
  const controller = new AbortController();
  await expect(
    archives.prepareInventoryImport(file, controller.signal),
  ).resolves.toEqual(archivePreview);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringMatching(/\/inventory-imports$/),
    expect.objectContaining({
      method: "POST",
      body: file,
      signal: controller.signal,
      headers: { "Content-Type": "application/zip" },
    }),
  );
});

// All token routes are encoded and confirmation retains the exact staged token and metadata.
test("reads, confirms and discards the same encoded import identity", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => archivePreview,
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => importedInventory,
    })
    .mockResolvedValueOnce({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetch);
  await archives.readInventoryImport("token/id");
  const data = { name: "Copy", description: null, group_id: "local" };
  await archives.confirmInventoryImport("token/id", data);
  await archives.discardInventoryImport("token/id");
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    expect.stringMatching(/\/inventory-imports\/token%2Fid$/),
    expect.stringMatching(/\/inventory-imports\/token%2Fid\/confirm$/),
    expect.stringMatching(/\/inventory-imports\/token%2Fid$/),
  ]);
  expect(fetch.mock.calls[1][1]).toMatchObject({
    method: "POST",
    body: JSON.stringify(data),
  });
  expect(fetch.mock.calls[2][1]).toMatchObject({ method: "DELETE" });
});

// Preparation returns only display metadata and cancellation never downloads the archive itself.
test("prepares and cancels scoped exports with cancellation signals", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => archiveExport,
    })
    .mockResolvedValueOnce({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await archives.prepareInventoryExport("inventory/id", controller.signal);
  await archives.discardInventoryExport("inventory/id", "export/id");
  expect(fetch.mock.calls[0][0]).toMatch(
    /\/inventories\/inventory%2Fid\/exports$/,
  );
  expect(fetch.mock.calls[0][1]).toMatchObject({
    method: "POST",
    signal: controller.signal,
  });
  expect(fetch.mock.calls[1][0]).toMatch(
    /\/inventories\/inventory%2Fid\/exports\/export%2Fid$/,
  );
});

// Browser downloads use a temporary native anchor, not a fetch/Blob or a new browsing context.
test("downloads the completed export directly in the current browsing context", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  archives.downloadInventoryExport("inventory/id", {
    ...archiveExport,
    id: "export/id",
  });
  const link = click.mock.contexts[0] as HTMLAnchorElement;
  expect(link.href).toBe(
    archives.inventoryExportDownloadUrl("inventory/id", "export/id"),
  );
  expect(link.target).toBe("_self");
  expect(link.download).toBe("Cables.zip");
  expect(link.isConnected).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});
