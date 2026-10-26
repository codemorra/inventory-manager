import { afterEach, expect, test, vi } from "vitest";
import {
  getInventoryTemplates,
  instantiateInventoryTemplate,
  saveInventoryTemplate,
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
