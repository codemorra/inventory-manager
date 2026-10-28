import { afterEach, expect, test, vi } from "vitest";
import * as api from "../../src/services/preferences";

afterEach(() => vi.unstubAllGlobals());

// All writes explicitly carry their captured revision.
test("uses the typed revisioned settings and view endpoints with encoded inventory IDs", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  await api.getApplicationSettings();
  await api.updateApplicationSettings(7, { theme: "dark" });
  await api.getInventoryViews();
  await api.getInventoryView("inventory/id");
  const preferences = {
    version: 1 as const,
    sort: null,
    hiddenFieldIds: [],
    wrapText: false,
    attachmentPreviews: false,
    columnWidths: {},
  };
  await api.updateInventoryView("inventory/id", 3, preferences);
  expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual([
    "/application-settings",
    "/application-settings",
    "/inventory-view-preferences",
    "/inventories/inventory%2Fid/view-preferences",
    "/inventories/inventory%2Fid/view-preferences",
  ]);
  expect(fetch.mock.calls[1]![1]).toMatchObject({
    method: "PATCH",
    body: JSON.stringify({
      expected_revision: 7,
      preferences: { theme: "dark" },
    }),
  });
  expect(fetch.mock.calls[4]![1]).toMatchObject({
    method: "PUT",
    body: JSON.stringify({ expected_revision: 3, preferences }),
  });
});
