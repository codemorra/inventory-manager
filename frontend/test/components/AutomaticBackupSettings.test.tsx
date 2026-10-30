import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AutomaticBackupSettings } from "../../src/components/AutomaticBackupSettings";
import * as api from "../../src/services/automaticBackups";
import { ApiError } from "../../src/services/api";
import { preferenceStore } from "../../src/preferences/store";
import { automaticSchedule } from "../helpers/automaticBackups";

vi.mock("../../src/services/automaticBackups", () => ({
  getBackupSchedule: vi.fn(),
  updateBackupSchedule: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(api.getBackupSchedule).mockResolvedValue(
    structuredClone(automaticSchedule),
  );
  vi.mocked(api.updateBackupSchedule).mockResolvedValue({
    ...automaticSchedule,
    revision: 9,
    policy: { frequency: "daily", retention: 3 },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

test("loads disabled scheduling and the automatic retention default without changing policy", async () => {
  render(<AutomaticBackupSettings disabled={false} onBusyChange={() => {}} />);
  expect(
    await screen.findByRole("combobox", { name: "Frequency" }),
  ).toHaveTextContent("Disabled");
  expect(screen.getByLabelText("Automatic backups to keep")).toHaveValue(10);
  expect(
    screen.getByRole("button", { name: "Save backup settings" }),
  ).toBeDisabled();
  expect(api.updateBackupSchedule).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Reload backup settings" }),
  ).not.toBeInTheDocument();
});

test("saves a complete policy using a freshly checked shared revision and refreshes appearance preferences", async () => {
  const busy = vi.fn();
  const refresh = vi.spyOn(preferenceStore, "refresh");
  render(<AutomaticBackupSettings disabled={false} onBusyChange={busy} />);
  await userEvent.click(
    await screen.findByRole("combobox", { name: "Frequency" }),
  );
  await userEvent.click(screen.getByRole("option", { name: "Daily" }));
  const input = screen.getByLabelText("Automatic backups to keep");
  await userEvent.clear(input);
  await userEvent.type(input, "3");
  vi.mocked(api.getBackupSchedule).mockResolvedValue({
    ...automaticSchedule,
    revision: 8,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Save backup settings" }),
  );
  expect(await screen.findByText("Backup settings saved.")).toBeVisible();
  expect(api.updateBackupSchedule).toHaveBeenCalledExactlyOnceWith(8, {
    frequency: "daily",
    retention: 3,
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(busy.mock.calls).toEqual([[true], [false]]);
  expect(
    screen.getByRole("button", { name: "Save backup settings" }),
  ).toBeDisabled();
});

test("keeps conflicting edits until an explicit reload accepts the changed policy", async () => {
  render(<AutomaticBackupSettings disabled={false} onBusyChange={() => {}} />);
  await userEvent.click(
    await screen.findByRole("combobox", { name: "Frequency" }),
  );
  await userEvent.click(screen.getByRole("option", { name: "Daily" }));
  vi.mocked(api.getBackupSchedule).mockResolvedValue({
    ...automaticSchedule,
    revision: 5,
    policy: { frequency: "weekly", retention: 20 },
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Save backup settings" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your edits are still here",
  );
  expect(screen.getByRole("combobox", { name: "Frequency" })).toHaveTextContent(
    "Daily",
  );
  expect(api.updateBackupSchedule).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "Reload backup settings" }),
  );
  expect(
    await screen.findByRole("combobox", { name: "Frequency" }),
  ).toHaveTextContent("Weekly");
  expect(screen.getByLabelText("Automatic backups to keep")).toHaveValue(20);
  expect(
    screen.queryByRole("button", { name: "Reload backup settings" }),
  ).not.toBeInTheDocument();
});

test("background status refreshes preserve the captured policy and edited retention", async () => {
  vi.useFakeTimers();
  render(<AutomaticBackupSettings disabled={false} onBusyChange={() => {}} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole("combobox", { name: "Frequency" }));
  fireEvent.click(screen.getByRole("option", { name: "Daily" }));
  const input = screen.getByLabelText("Automatic backups to keep");
  fireEvent.change(input, { target: { value: "7" } });
  vi.mocked(api.getBackupSchedule).mockResolvedValue({
    ...automaticSchedule,
    revision: 99,
    policy: { frequency: "weekly", retention: 50 },
    last_success: {
      id: "automatic-id",
      filename: "automatic.zip",
      created_at: "2026-10-28T12:00:00.000Z",
      completed_at: "2026-10-28T12:01:00.000Z",
    },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(screen.getByText(/Last automatic backup:/)).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Frequency" })).toHaveTextContent(
    "Daily",
  );
  expect(input).toHaveValue(7);
  fireEvent.click(screen.getByRole("button", { name: "Save backup settings" }));
  await act(async () => {});
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Your edits are still here",
  );
  expect(api.updateBackupSchedule).not.toHaveBeenCalled();
});

test("validates retention and shows the saved weekly frequency and cleanup retry status", async () => {
  vi.mocked(api.getBackupSchedule).mockResolvedValue({
    ...automaticSchedule,
    policy: { frequency: "weekly", retention: 10 },
    last_failure: { at: "2026-10-28T12:00:00.000Z", stage: "retention" },
    retention_pending: true,
    next_retry_at: "2026-10-28T12:05:00.000Z",
  });
  render(<AutomaticBackupSettings disabled={false} onBusyChange={() => {}} />);
  expect(
    await screen.findByRole("combobox", { name: "Frequency" }),
  ).toHaveTextContent("Weekly");
  expect(screen.getByRole("alert")).toHaveTextContent("could not be removed");
  expect(screen.getByRole("alert")).toHaveTextContent("Next attempt");
  expect(
    screen.queryByRole("button", { name: "Reload backup settings" }),
  ).not.toBeInTheDocument();
  const input = screen.getByLabelText("Automatic backups to keep");
  await userEvent.clear(input);
  await userEvent.type(input, "0");
  expect(
    screen.getByRole("button", { name: "Save backup settings" }),
  ).toBeDisabled();
  await userEvent.clear(input);
  await userEvent.type(input, "1001");
  expect(
    screen.getByRole("button", { name: "Save backup settings" }),
  ).toBeDisabled();
});

test("reloads after a failed read and preserves inputs after an uncertain save response", async () => {
  vi.mocked(api.getBackupSchedule).mockRejectedValueOnce(
    new Error("Read failed"),
  );
  render(<AutomaticBackupSettings disabled={false} onBusyChange={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be loaded",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Reload backup settings" }),
  );
  await userEvent.click(
    await screen.findByRole("combobox", { name: "Frequency" }),
  );
  await userEvent.click(screen.getByRole("option", { name: "Daily" }));
  vi.mocked(api.updateBackupSchedule).mockRejectedValueOnce(
    new ApiError(500, "Save failed"),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save backup settings" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be saved",
  );
  expect(
    screen.getByRole("button", { name: "Reload backup settings" }),
  ).toBeVisible();
  expect(screen.getByRole("combobox", { name: "Frequency" })).toHaveTextContent(
    "Daily",
  );
});
