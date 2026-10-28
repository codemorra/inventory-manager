import { afterEach, expect, test, vi } from "vitest";
import {
  getBackupSchedule,
  updateBackupSchedule,
} from "../../src/services/automaticBackups";
import { automaticSchedule } from "../helpers/automaticBackups";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("forwards cancellation and saves the complete policy at the checked settings revision", async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => automaticSchedule,
  });
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  await expect(getBackupSchedule(controller.signal)).resolves.toEqual(
    automaticSchedule,
  );
  await updateBackupSchedule(7, { frequency: "weekly", retention: 5 });
  expect(fetch.mock.calls[0]).toEqual([
    expect.stringMatching(/\/backups\/schedule$/),
    expect.objectContaining({ signal: controller.signal }),
  ]);
  expect(fetch.mock.calls[1]).toEqual([
    expect.stringMatching(/\/backups\/schedule$/),
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        expected_revision: 7,
        policy: { frequency: "weekly", retention: 5 },
      }),
    }),
  ]);
});
