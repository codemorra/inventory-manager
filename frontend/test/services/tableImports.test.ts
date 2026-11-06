import { afterEach, expect, test, vi } from "vitest";
import * as tables from "../../src/services/tableImports";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// File parsing settings are encoded in the URL; the original File reaches the backend without browser-side conversion.
test.each(["csv", "markdown"] as const)(
  "streams a %s file with its format and cancellation signal",
  async (format) => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: "table" }),
    });
    vi.stubGlobal("fetch", fetch);
    const file = new File(["data"], `table.${format === "csv" ? "csv" : "md"}`);
    const controller = new AbortController();
    await tables.prepareTableImport(file, format, ";", controller.signal);
    const [url, options] = fetch.mock.calls[0]!;
    const query = new URL(url).searchParams;
    expect(query.get("format")).toBe(format);
    expect(query.get("delimiter")).toBe(format === "csv" ? ";" : null);
    expect(options).toMatchObject({
      method: "POST",
      body: file,
      signal: controller.signal,
      headers: {
        "Content-Type": format === "csv" ? "text/csv" : "text/markdown",
      },
    });
  },
);

// Preview/validation requests retain source coordinates and forward cancellation without changing literal separators.
test("encodes tokens, pages source rows and checks the exact mapping", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await tables.readTableImportRows("token/id", 50, 50, controller.signal);
  expect(fetch.mock.calls[0]![0]).toMatch(
    /\/inventory-table-imports\/token%2Fid\/rows\?offset=50&limit=50$/,
  );
  expect(fetch.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  const columns = [
    { column: 1, name: "Ports", field_type: "multiselect", separator: "|" },
  ] as const;
  await tables.validateTableImport("token/id", [...columns], controller.signal);
  expect(fetch.mock.calls[1]![0]).toMatch(
    /\/inventory-table-imports\/token%2Fid\/validate$/,
  );
  expect(fetch.mock.calls[1]![1]).toMatchObject({
    method: "POST",
    body: JSON.stringify({ columns }),
    signal: controller.signal,
  });
});

// Confirmation and receipt recovery share the captured token; discarding it never sends an inventory deletion request.
test("confirms, reads status and discards the same scoped table token", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ id: "inventory" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "completed" }),
    })
    .mockResolvedValueOnce({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetch);
  const data = {
    name: "Foreign table",
    description: null,
    group_id: null,
    columns: [{ column: 0, name: "Value", field_type: "text" as const }],
  };
  await tables.confirmTableImport("token/id", data);
  await tables.readTableImport("token/id");
  await tables.discardTableImport("token/id");
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    expect.stringMatching(/\/inventory-table-imports\/token%2Fid\/confirm$/),
    expect.stringMatching(/\/inventory-table-imports\/token%2Fid$/),
    expect.stringMatching(/\/inventory-table-imports\/token%2Fid$/),
  ]);
  expect(fetch.mock.calls[0]![1]).toMatchObject({
    method: "POST",
    body: JSON.stringify(data),
  });
  expect(fetch.mock.calls[2]![1]).toMatchObject({ method: "DELETE" });
});
