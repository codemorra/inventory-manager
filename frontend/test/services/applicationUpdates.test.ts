import { afterEach, expect, test, vi } from "vitest";
import { checkForUpdates } from "../../src/services/applicationUpdates";

afterEach(() => vi.unstubAllGlobals());

test("uses the local backend with explicit cancellation and no response cache", async () => {
  const result = { current_version: "0.0.0", status: "no_release" };
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => result });
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  expect(await checkForUpdates(controller.signal)).toEqual(result);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "http://127.0.0.1:8000/application-update",
    expect.objectContaining({ signal: controller.signal, cache: "no-store" }),
  );
});
