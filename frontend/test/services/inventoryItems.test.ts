import { afterEach, expect, test, vi } from "vitest";
import {
  deleteInventoryItem,
  updateInventoryItem,
} from "../../src/services/inventoryItems";
import { ApiError } from "../../src/services/api";

afterEach(() => vi.unstubAllGlobals());

// Test item replacements transmit the captured revision alongside the complete editable values.
test("sends the expected revision with an item replacement", async () => {
  const result = { id: "item", revision: 8, values: [] };
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => result });
  vi.stubGlobal("fetch", fetch);
  await expect(
    updateInventoryItem("inventory", "item", {
      expected_revision: 7,
      values: [],
    }),
  ).resolves.toEqual(result);
  expect(fetch.mock.calls[0][1]).toMatchObject({
    method: "PATCH",
    body: JSON.stringify({ expected_revision: 7, values: [] }),
  });
});

// Test deletion carries its own revision precondition and handles the empty successful response.
test("sends the expected revision when confirming deletion", async () => {
  const json = vi.fn();
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 204, json });
  vi.stubGlobal("fetch", fetch);
  await expect(
    deleteInventoryItem("inventory", "item", 7),
  ).resolves.toBeUndefined();
  expect(fetch.mock.calls[0][1]).toMatchObject({
    method: "DELETE",
    body: JSON.stringify({ expected_revision: 7 }),
  });
  expect(json).not.toHaveBeenCalled();
});

// Test stale-write errors retain their stable code and are never silently retried by the API client.
test("preserves a conflict response without retrying a stale replacement", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({
      detail: {
        code: "inventory_item_conflict",
        message: "Reload before saving.",
      },
    }),
  });
  vi.stubGlobal("fetch", fetch);
  const error = await updateInventoryItem("inventory", "item", {
    expected_revision: 7,
    values: [],
  }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 409, code: "inventory_item_conflict" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
