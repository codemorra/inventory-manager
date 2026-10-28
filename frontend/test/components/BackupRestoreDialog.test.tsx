import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BackupRestoreDialog } from "../../src/components/BackupRestoreDialog";
import * as api from "../../src/services/backups";
import { ApiError } from "../../src/services/api";
import {
  restoreBackup,
  restorePreview,
  restoreReceipt,
} from "../helpers/backupRestores";
import { deferred } from "../helpers/inventoryArchives";
import type { RestorePreview, RestoreReceipt } from "../../src/types/backup";

vi.mock("../../src/services/backups", () => ({
  prepareBackupRestore: vi.fn(),
  confirmBackupRestore: vi.fn(),
  readBackupRestore: vi.fn(),
  discardBackupRestore: vi.fn(),
  reloadAfterRestore: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(api.prepareBackupRestore).mockResolvedValue(restorePreview);
  vi.mocked(api.confirmBackupRestore).mockResolvedValue(restoreReceipt);
  vi.mocked(api.discardBackupRestore).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

test("checks a stored archive and shows its summary before allowing explicit replacement", async () => {
  const busy = vi.fn();
  render(
    <BackupRestoreDialog
      source={restoreBackup.filename}
      onClose={() => {}}
      onBusyChange={busy}
    />,
  );
  expect(await screen.findByText("Inventories")).toBeVisible();
  expect(screen.getByText("2")).toBeVisible();
  expect(screen.getByText("5")).toBeVisible();
  expect(screen.getByText("3 · 1 KiB")).toBeVisible();
  expect(screen.getByText(/replaces the current data/)).toBeVisible();
  expect(api.prepareBackupRestore).toHaveBeenCalledWith(
    "backup.zip",
    expect.any(AbortSignal),
  );
  expect(api.confirmBackupRestore).not.toHaveBeenCalled();
  expect(busy.mock.calls).toEqual([[true], [false]]);
});

test("confirms only once, prevents dismissal and requires a fresh application load after success", async () => {
  const pending = deferred<RestoreReceipt>();
  const close = vi.fn();
  vi.mocked(api.confirmBackupRestore).mockReturnValue(pending.promise);
  render(
    <BackupRestoreDialog
      source={restoreBackup.filename}
      onClose={close}
      onBusyChange={() => {}}
    />,
  );
  const confirm = await screen.findByRole("button", {
    name: "Replace data and restore",
  });
  await userEvent.dblClick(confirm);
  expect(api.confirmBackupRestore).toHaveBeenCalledExactlyOnceWith(
    "restore-id",
  );
  expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
  await act(async () => pending.resolve(restoreReceipt));
  expect(await screen.findByText(/Your data has been restored/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Replace data and restore" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Reload application" }),
  );
  expect(api.reloadAfterRestore).toHaveBeenCalledOnce();
});

test("streams the selected external File through preparation without wrapping its body", async () => {
  const file = new File(["zip"], "external.zip", { type: "application/zip" });
  render(
    <BackupRestoreDialog
      source={file}
      onClose={() => {}}
      onBusyChange={() => {}}
    />,
  );
  expect(await screen.findByText("external.zip")).toBeVisible();
  expect(api.prepareBackupRestore).toHaveBeenCalledWith(
    file,
    expect.any(AbortSignal),
  );
  expect(
    await screen.findByRole("button", { name: "Replace data and restore" }),
  ).toBeEnabled();
});

test("recovers a successful lost response using the original token without repeating restoration", async () => {
  vi.mocked(api.confirmBackupRestore).mockRejectedValueOnce(
    new TypeError("Lost reply"),
  );
  vi.mocked(api.readBackupRestore).mockResolvedValue({
    id: restorePreview.id,
    status: "completed",
    receipt: restoreReceipt,
  });
  render(
    <BackupRestoreDialog
      source={restoreBackup.filename}
      onClose={() => {}}
      onBusyChange={() => {}}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Replace data and restore" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be confirmed",
  );
  expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Check status" }));
  expect(await screen.findByText(/Your data has been restored/)).toBeVisible();
  expect(api.confirmBackupRestore).toHaveBeenCalledOnce();
  expect(api.readBackupRestore).toHaveBeenCalledExactlyOnceWith("restore-id");
});

test("requires another explicit confirmation when status proves the first attempt was not applied", async () => {
  vi.mocked(api.confirmBackupRestore).mockRejectedValueOnce(
    new TypeError("Lost reply"),
  );
  vi.mocked(api.readBackupRestore).mockResolvedValue(restorePreview);
  render(
    <BackupRestoreDialog
      source={restoreBackup.filename}
      onClose={() => {}}
      onBusyChange={() => {}}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Replace data and restore" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Check status" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "was not completed",
  );
  expect(api.confirmBackupRestore).toHaveBeenCalledOnce();
  await userEvent.click(
    screen.getByRole("button", { name: "Replace data and restore" }),
  );
  expect(await screen.findByText(/Your data has been restored/)).toBeVisible();
  expect(api.confirmBackupRestore).toHaveBeenCalledTimes(2);
});

test("discards a late preparation response after the dialog is dismissed", async () => {
  const pending = deferred<RestorePreview>();
  vi.mocked(api.prepareBackupRestore).mockReturnValue(pending.promise);
  const view = render(
    <BackupRestoreDialog
      source={restoreBackup.filename}
      onClose={() => {}}
      onBusyChange={() => {}}
    />,
  );
  await waitFor(() => expect(api.prepareBackupRestore).toHaveBeenCalledOnce());
  const signal = vi.mocked(api.prepareBackupRestore).mock.calls[0]![1]!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(restorePreview));
  expect(api.discardBackupRestore).toHaveBeenCalledExactlyOnceWith(
    "restore-id",
  );
});

test("blocks expired confirmations and explains invalid archives without replacing data", async () => {
  vi.mocked(api.prepareBackupRestore).mockRejectedValueOnce(
    new ApiError(422, "Invalid", "invalid_backup_archive"),
  );
  render(
    <BackupRestoreDialog
      source={restoreBackup.filename}
      onClose={() => {}}
      onBusyChange={() => {}}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "invalid, damaged or incompatible",
  );
  vi.mocked(api.prepareBackupRestore).mockResolvedValueOnce({
    ...restorePreview,
    expires_at: "2000-01-01T00:00:00.000Z",
  });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Replace data and restore" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "no longer available",
  );
  expect(api.confirmBackupRestore).not.toHaveBeenCalled();
});
