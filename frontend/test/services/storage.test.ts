import { afterEach, expect, test, vi } from "vitest";
import {
  cancelStorageMove,
  getStorageLocations,
  changeStorageLocations,
} from "../../src/services/storage";

afterEach(() => vi.unstubAllGlobals());

test("reads active locations and sends revisioned relocation and cancellation requests", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetch);
  await getStorageLocations();
  await changeStorageLocations(4, {
    dataDirectory: "/chosen/data",
    backupsDirectory: "/chosen/backups",
  });
  await cancelStorageMove(5);
  expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(
    Array(3).fill("/storage-locations"),
  );
  expect(fetch.mock.calls[1]![1]).toMatchObject({
    method: "PUT",
    body: JSON.stringify({
      expected_revision: 4,
      dataDirectory: "/chosen/data",
      backupsDirectory: "/chosen/backups",
    }),
  });
  expect(fetch.mock.calls[2]![1]).toMatchObject({
    method: "DELETE",
    body: JSON.stringify({ expected_revision: 5 }),
  });
});
