import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

test("pins the data generation, rejects changed responses and keeps stale writes marked with their original generation", async () => {
  vi.resetModules();
  const api = await import("../../src/services/api");
  const changed = vi.fn();
  window.addEventListener(api.dataChangedEvent, changed);
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ "X-Inventory-Generation": "first" }),
      json: async () => ({}),
    })
    .mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "X-Inventory-Generation": "restored" }),
      json: async () => ({}),
    });
  vi.stubGlobal("fetch", fetch);
  try {
    await api.request("/application-settings");
    await expect(api.request("/inventories")).rejects.toMatchObject({
      code: "application_data_changed",
    });
    await expect(
      api.request("/inventories", { method: "POST" }),
    ).rejects.toMatchObject({ code: "application_data_changed" });
    expect(changed).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[2]![1]).toMatchObject({
      headers: { "X-Inventory-Generation": "first" },
    });
  } finally {
    window.removeEventListener(api.dataChangedEvent, changed);
  }
});
