import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { BackupSettings } from "../../src/components/BackupSettings";
import { SettingsDialog } from "../../src/components/SettingsDialog";
import { ApiError } from "../../src/services/api";
import * as api from "../../src/services/backups";
import { deferred } from "../helpers/inventoryArchives";
import type { CreatedBackup, StoredBackup } from "../../src/types/backup";
import i18n from "../../src/i18n";

vi.mock("../../src/services/backups", () => ({
  listBackups: vi.fn(),
  createBackup: vi.fn(),
  downloadBackup: vi.fn(),
}));
const created: CreatedBackup = {
  id: "backup-id",
  filename: "backup.zip",
  created_at: "2026-10-28T11:00:00.000Z",
  byte_size: 2048,
  kind: "manual",
};
const stored: StoredBackup = {
  filename: created.filename,
  byte_size: created.byte_size,
  metadata: {
    id: created.id,
    created_at: created.created_at,
    kind: created.kind,
  },
};
beforeEach(() => {
  vi.mocked(api.listBackups).mockResolvedValue([]);
  vi.mocked(api.createBackup).mockResolvedValue(created);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

test("loads backups only when their settings section is expanded", async () => {
  render(<SettingsDialog onClose={() => {}} />);
  expect(api.listBackups).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText("Backups"));
  expect(await screen.findByText("No backups yet.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Create backup" })).toBeEnabled();
});

test("shows metadata and unreadable entries and delegates downloads to the native downloader", async () => {
  vi.mocked(api.listBackups).mockResolvedValue([
    stored,
    { filename: "damaged.zip", byte_size: 10, metadata: null },
  ]);
  render(<BackupSettings onBusyChange={() => {}} />);
  expect(await screen.findByText("backup.zip")).toBeVisible();
  expect(screen.getByText("Manual")).toBeVisible();
  expect(screen.getByText("2 KiB")).toBeVisible();
  expect(screen.getByText("Metadata could not be read")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Download backup.zip" }),
  );
  expect(api.downloadBackup).toHaveBeenCalledExactlyOnceWith("backup.zip");
});

test("keeps an accepted creation mounted and blocks dismissal and appearance changes until it finishes", async () => {
  const pending = deferred<CreatedBackup>();
  const close = vi.fn();
  vi.mocked(api.createBackup).mockReturnValue(pending.promise);
  render(<SettingsDialog onClose={close} />);
  await userEvent.click(screen.getByText("Backups"));
  await screen.findByText("No backups yet.");
  await userEvent.dblClick(
    screen.getByRole("button", { name: "Create backup" }),
  );
  expect(api.createBackup).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Appearance")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Close dialog" })).toBeDisabled();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(screen.getByRole("dialog").parentElement!);
  expect(close).not.toHaveBeenCalled();
  await userEvent.click(screen.getByText("Backups"));
  await userEvent.click(screen.getByText("Backups"));
  expect(api.listBackups).toHaveBeenCalledOnce();
  vi.mocked(api.listBackups).mockResolvedValue([stored]);
  await act(async () => {
    pending.resolve(created);
  });
  expect(await screen.findByText("Backup saved.")).toBeVisible();
  expect(screen.getByLabelText("Appearance")).toBeEnabled();
  expect(screen.getByRole("button", { name: "Close dialog" })).toBeEnabled();
  expect(screen.getByText("backup.zip")).toBeVisible();
});

test("requires a list refresh after an uncertain creation response without automatically creating another backup", async () => {
  vi.mocked(api.createBackup).mockRejectedValueOnce(
    new TypeError("Connection lost"),
  );
  render(<BackupSettings onBusyChange={() => {}} />);
  await screen.findByText("No backups yet.");
  await userEvent.click(screen.getByRole("button", { name: "Create backup" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be confirmed",
  );
  expect(screen.getByRole("button", { name: "Create backup" })).toBeDisabled();
  vi.mocked(api.listBackups).mockResolvedValue([stored]);
  await userEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  expect(await screen.findByText("backup.zip")).toBeVisible();
  expect(screen.getByRole("button", { name: "Create backup" })).toBeEnabled();
  expect(api.createBackup).toHaveBeenCalledOnce();
});

test("preserves a successfully created entry if the following catalog refresh fails", async () => {
  const busy = vi.fn();
  render(<BackupSettings onBusyChange={busy} />);
  await screen.findByText("No backups yet.");
  vi.mocked(api.listBackups).mockRejectedValueOnce(new Error("Read failed"));
  await userEvent.click(screen.getByRole("button", { name: "Create backup" }));
  expect(await screen.findByText("Backup saved.")).toBeVisible();
  expect(screen.getByText("backup.zip")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "list could not be loaded",
  );
  expect(busy.mock.calls).toEqual([[true], [false]]);
  expect(api.createBackup).toHaveBeenCalledOnce();
});

test("recovers a failed list load and reports checked creation failures without losing the list", async () => {
  vi.mocked(api.listBackups).mockRejectedValueOnce(new Error("Read failed"));
  render(<BackupSettings onBusyChange={() => {}} />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "list could not be loaded",
  );
  vi.mocked(api.listBackups).mockResolvedValue([stored]);
  await userEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  await screen.findByText("backup.zip");
  vi.mocked(api.createBackup).mockRejectedValueOnce(
    new ApiError(422, "Bad file", "invalid_backup_archive"),
  );
  await userEvent.click(screen.getByRole("button", { name: "Create backup" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "backup could not be created",
  );
  expect(screen.getByText("backup.zip")).toBeVisible();
  expect(screen.getByRole("button", { name: "Create backup" })).toBeEnabled();
});

test("aborts a pending list request when its view is dismissed", async () => {
  const pending = deferred<StoredBackup[]>();
  vi.mocked(api.listBackups).mockReturnValue(pending.promise);
  const view = render(<BackupSettings onBusyChange={() => {}} />);
  await waitFor(() => expect(api.listBackups).toHaveBeenCalledOnce());
  const signal = vi.mocked(api.listBackups).mock.calls[0]![0]!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve([stored]));
});

test("renders backup controls in German", async () => {
  await i18n.changeLanguage("de");
  render(<BackupSettings onBusyChange={() => {}} />);
  expect(
    await screen.findByText("Noch keine Backups vorhanden."),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Backup erstellen" }),
  ).toBeEnabled();
});
