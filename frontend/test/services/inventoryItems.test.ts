import { afterEach, expect, test, vi } from "vitest";
import {
  deleteInventoryItem,
  updateInventoryItem,
  updateInventoryItems,
} from "../../src/services/inventoryItems";
import { ApiError } from "../../src/services/api";

afterEach(() => vi.unstubAllGlobals());

// Test the atomic client transmits original versions and exposes the failed row without retries.
test("sends one atomic request and preserves a row-specific conflict", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({
      detail: {
        code: "inventory_item_conflict",
        message: "Stale row.",
        item_id: "second",
      },
    }),
  });
  vi.stubGlobal("fetch", fetch);
  const input = {
    expected_configuration_revision: 7,
    items: [
      { item_id: "first", expected_revision: 2, values: [] },
      { item_id: "second", expected_revision: 3, values: [] },
    ],
  };
  await expect(updateInventoryItems("inventory", input)).rejects.toMatchObject({
    status: 409,
    code: "inventory_item_conflict",
    itemId: "second",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toMatch(/\/inventories\/inventory\/items$/u);
  expect(fetch.mock.calls[0][1]).toMatchObject({
    method: "PATCH",
    body: JSON.stringify(input),
  });
});

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
