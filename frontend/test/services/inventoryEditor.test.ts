import { afterEach, expect, test, vi } from "vitest";
import {
  getInventoryConfiguration,
  saveInventoryConfiguration,
} from "../../src/services/inventoryEditor";

afterEach(() => vi.unstubAllGlobals());

// Test the editor loads metadata, definitions, and revision through one snapshot endpoint.
test("loads a coherent configuration snapshot", async () => {
  const result = {
    inventory: { id: "inventory", configuration_revision: 7 },
    fields: [],
  };
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => result });
  vi.stubGlobal("fetch", fetch);
  await expect(getInventoryConfiguration("inventory")).resolves.toEqual(result);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toMatch(
    /\/inventories\/inventory\/configuration$/,
  );
});

// Test the original revision travels with the entire draft and conflicts are not retried.
test("submits the captured configuration revision without retrying conflicts", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({
      detail: {
        code: "inventory_configuration_conflict",
        message: "Reload before saving.",
      },
    }),
  });
  vi.stubGlobal("fetch", fetch);
  const input = {
    expected_revision: 7,
    inventory: { name: "Draft", description: null },
    fields: [],
    options: [],
  };
  await expect(
    saveInventoryConfiguration("inventory", input),
  ).rejects.toMatchObject({
    status: 409,
    code: "inventory_configuration_conflict",
  });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1]).toMatchObject({
    method: "PATCH",
    body: JSON.stringify(input),
  });
});
