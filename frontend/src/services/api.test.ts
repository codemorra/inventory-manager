import { afterEach, describe, expect, it, vi } from "vitest";

import { request } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("returns undefined for a successful 204 response", async () => {
    const response = {
      json: vi.fn(),
      ok: true,
      status: 204,
    } as unknown as Response;

    const mockedFetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", mockedFetch);

    await expect(
      request<void>("/inventories/inventory-1", {
        method: "DELETE",
      }),
    ).resolves.toBeUndefined();

    expect(response.json).not.toHaveBeenCalled();
  });
});
