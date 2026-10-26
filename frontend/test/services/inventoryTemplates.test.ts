import { afterEach, expect, test, vi } from "vitest";
import {
  getInventoryTemplates,
  instantiateInventoryTemplate,
  saveInventoryTemplate,
  getInventoryTemplate,
  updateInventoryTemplate,
  deleteInventoryTemplate,
} from "../../src/services/inventoryTemplates";

afterEach(() => vi.unstubAllGlobals());

// Verify the public list transport and source snapshot contract without any item payload.
test("loads templates and saves a captured source configuration", async () => {
  const result = { id: "template", revision: 1, fields: [] };
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 201, json: async () => result });
  vi.stubGlobal("fetch", fetch);
  await getInventoryTemplates();
  expect(fetch.mock.calls[0][0]).toMatch(/\/inventory-templates$/);
  const input = {
    name: "Blueprint",
    description: null,
    source_inventory_id: "source",
    expected_configuration_revision: 7,
  };
  await expect(saveInventoryTemplate(input)).resolves.toEqual(result);
  expect(fetch.mock.calls[1][1]).toMatchObject({
    method: "POST",
    body: JSON.stringify(input),
  });
});

// Revision conflicts reach the UI without automatic retries or partial creation requests.
test("sends one template instantiation and preserves structured conflict errors", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 409,
    json: async () => ({
      detail: { code: "inventory_template_conflict", message: "Changed" },
    }),
  });
  vi.stubGlobal("fetch", fetch);
  const input = {
    expected_revision: 4,
    name: "New inventory",
    description: null,
    group_id: "office",
  };
  await expect(
    instantiateInventoryTemplate("template", input),
  ).rejects.toMatchObject({ status: 409, code: "inventory_template_conflict" });
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toMatch(
    /\/inventory-templates\/template\/inventories$/,
  );
  expect(fetch.mock.calls[0][1]).toMatchObject({
    method: "POST",
    body: JSON.stringify(input),
  });
});

// Detail, update, and deletion preserve the public snapshot/revision contracts on the wire.
test("reads, replaces, and deletes templates through revision-checked endpoints", async () => {
  const result = { id: "template", revision: 9, fields: [] };
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => result });
  vi.stubGlobal("fetch", fetch);
  await expect(getInventoryTemplate("template")).resolves.toEqual(result);
  const input = {
    expected_revision: 9,
    name: "Structure",
    description: null,
    fields: [],
  };
  await expect(updateInventoryTemplate("template", input)).resolves.toEqual(
    result,
  );
  expect(fetch.mock.calls[1][1]).toMatchObject({
    method: "PATCH",
    body: JSON.stringify(input),
  });
  fetch.mockResolvedValue({
    ok: true,
    status: 204,
    json: async () => {
      throw new Error("204 has no body");
    },
  });
  await expect(deleteInventoryTemplate("template", 9)).resolves.toBeUndefined();
  expect(fetch.mock.calls[2][1]).toMatchObject({
    method: "DELETE",
    body: JSON.stringify({ expected_revision: 9 }),
  });
  expect(
    fetch.mock.calls.every(([url]) =>
      /\/inventory-templates\/template$/.test(url),
    ),
  ).toBe(true);
});
