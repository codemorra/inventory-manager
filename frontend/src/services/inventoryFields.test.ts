import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInventoryField,
  createInventoryFieldOption,
  deleteInventoryFieldOption,
  getInventoryFieldOptions,
  updateInventoryFieldOption,
} from "./inventoryFields";

function createResponse(data: unknown, status = 200): Response {
  return {
    json: vi.fn().mockResolvedValue(data),
    ok: status >= 200 && status < 300,
    status,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inventory field service", () => {
  it("creates a configured select field", async () => {
    const response = createResponse({ id: "field-1" }, 201);
    const mockedFetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", mockedFetch);

    await createInventoryField("inventory-1", {
      name: "Played",
      field_type: "select",
      options: [{ name: "Not started" }, { name: "Completed" }],
    });

    expect(mockedFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/inventories/inventory-1/fields",
      expect.objectContaining({
        body: JSON.stringify({
          name: "Played",
          field_type: "select",
          options: [{ name: "Not started" }, { name: "Completed" }],
        }),
        method: "POST",
      }),
    );
  });

  it("uses the expected option endpoints", async () => {
    const mockedFetch = vi
      .fn()
      .mockResolvedValueOnce(createResponse([]))
      .mockResolvedValueOnce(createResponse({ id: "option-1" }, 201))
      .mockResolvedValueOnce(createResponse({ id: "option-1" }))
      .mockResolvedValueOnce(createResponse(undefined, 204));
    vi.stubGlobal("fetch", mockedFetch);

    await getInventoryFieldOptions("inventory-1", "field-1");
    await createInventoryFieldOption("inventory-1", "field-1", {
      name: "Completed",
    });
    await updateInventoryFieldOption("inventory-1", "field-1", "option-1", {
      name: "Done",
    });
    await deleteInventoryFieldOption("inventory-1", "field-1", "option-1");

    expect(mockedFetch.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:8000/inventories/inventory-1/fields/field-1/options",
      "http://127.0.0.1:8000/inventories/inventory-1/fields/field-1/options",
      "http://127.0.0.1:8000/inventories/inventory-1/fields/field-1/options/option-1",
      "http://127.0.0.1:8000/inventories/inventory-1/fields/field-1/options/option-1",
    ]);
    expect(mockedFetch.mock.calls.map(([, options]) => options?.method)).toEqual([
      undefined,
      "POST",
      "PATCH",
      "DELETE",
    ]);
  });
});
