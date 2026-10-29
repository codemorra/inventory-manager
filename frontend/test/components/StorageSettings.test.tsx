import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { StorageSettings } from "../../src/components/StorageSettings";
import { SettingsPage } from "../../src/pages/SettingsPage";
import { preferenceStore } from "../../src/preferences/store";
import { ApiError } from "../../src/services/api";
import * as api from "../../src/services/storage";
import type { StorageLocationState } from "../../src/types/storage";
import { deferred } from "../helpers/inventoryArchives";

vi.mock("../../src/services/storage", () => ({
  getStorageLocations: vi.fn(),
  changeStorageLocations: vi.fn(),
  cancelStorageMove: vi.fn(),
}));
const original: StorageLocationState = {
  revision: 2,
  paths: {
    dataDirectory: "/app/data",
    backupsDirectory: "/app/backups",
    databasePath: "/app/data/inventory.db",
    settingsPath: "/app/config/settings.json",
    logsDirectory: "/app/logs",
    tempDirectory: "/app/temp",
  },
  defaults: { dataDirectory: "/app/data", backupsDirectory: "/app/backups" },
  dataMovable: true,
  pending: null,
  cleanupPending: false,
  moveFailed: false,
};
const planned: StorageLocationState = {
  ...original,
  revision: 3,
  pending: {
    dataDirectory: "/new/data",
    backupsDirectory: original.paths.backupsDirectory,
  },
};
beforeEach(() => {
  vi.mocked(api.getStorageLocations).mockResolvedValue(
    structuredClone(original),
  );
  vi.mocked(api.changeStorageLocations).mockResolvedValue(
    structuredClone(planned),
  );
  vi.mocked(api.cancelStorageMove).mockResolvedValue({
    ...original,
    revision: 4,
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function changeData() {
  const input = await screen.findByLabelText(
    "Data folder (inventories and attachments)",
  );
  await userEvent.clear(input);
  await userEvent.type(input, "/new/data");
}

test("loads storage paths only when the settings section is selected", async () => {
  render(<SettingsPage />);
  expect(api.getStorageLocations).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("tab", { name: "Storage locations" }));
  expect(
    await screen.findByLabelText("Data folder (inventories and attachments)"),
  ).toHaveValue("/app/data");
  expect(
    screen.getByRole("button", { name: "Change storage locations" }),
  ).toBeDisabled();
});

test("uses the latest settings revision for scheduling, refreshes preferences and exposes cancelation", async () => {
  const busy = vi.fn();
  const refresh = vi.spyOn(preferenceStore, "refresh");
  render(<StorageSettings onBusyChange={busy} />);
  await changeData();
  vi.mocked(api.getStorageLocations).mockResolvedValue({
    ...original,
    revision: 8,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Change storage locations" }),
  );
  await screen.findByRole("button", { name: "Cancel scheduled change" });
  expect(api.changeStorageLocations).toHaveBeenCalledWith(8, {
    dataDirectory: "/new/data",
    backupsDirectory: "/app/backups",
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(busy.mock.calls).toEqual([[true], [false]]);
  expect(
    screen.getByLabelText("Data folder (inventories and attachments)"),
  ).toBeDisabled();
  vi.mocked(api.getStorageLocations).mockResolvedValue(planned);
  await userEvent.click(
    screen.getByRole("button", { name: "Cancel scheduled change" }),
  );
  await waitFor(() => expect(api.cancelStorageMove).toHaveBeenCalledWith(3));
  await waitFor(() =>
    expect(
      screen.getByLabelText("Data folder (inventories and attachments)"),
    ).toBeEnabled(),
  );
  expect(
    screen.getByLabelText("Data folder (inventories and attachments)"),
  ).toHaveValue("/app/data");
});

test("never overwrites a path plan created elsewhere while this dialog was open", async () => {
  render(<StorageSettings onBusyChange={() => {}} />);
  await changeData();
  vi.mocked(api.getStorageLocations).mockResolvedValue({
    ...planned,
    pending: {
      dataDirectory: "/other/data",
      backupsDirectory: "/other/backups",
    },
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Change storage locations" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("have changed");
  expect(api.changeStorageLocations).not.toHaveBeenCalled();
  expect(
    screen.getByLabelText("Data folder (inventories and attachments)"),
  ).toHaveValue("/new/data");
});

test("reloads after an uncertain save acknowledgment and shows the actual pending plan", async () => {
  render(<StorageSettings onBusyChange={() => {}} />);
  await changeData();
  vi.mocked(api.changeStorageLocations).mockRejectedValueOnce(
    new TypeError("Lost connection"),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Change storage locations" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be changed",
  );
  vi.mocked(api.getStorageLocations).mockResolvedValue(planned);
  await userEvent.click(
    screen.getByRole("button", { name: "Reload locations" }),
  );
  expect(
    await screen.findByRole("button", { name: "Cancel scheduled change" }),
  ).toBeEnabled();
});

test("blocks an overridden data path while still allowing backup changes and shows fixed paths", async () => {
  vi.mocked(api.getStorageLocations).mockResolvedValue({
    ...original,
    dataMovable: false,
  });
  render(<StorageSettings onBusyChange={() => {}} />);
  expect(
    await screen.findByLabelText("Data folder (inventories and attachments)"),
  ).toBeDisabled();
  expect(screen.getByLabelText("Backup folder")).toBeEnabled();
  await userEvent.click(screen.getByText("Other application paths"));
  expect(screen.getByText(original.paths.settingsPath)).toBeVisible();
});

test("disables appearance controls until a storage request completes", async () => {
  const pending = deferred<StorageLocationState>();
  vi.mocked(api.changeStorageLocations).mockReturnValue(pending.promise);
  render(<SettingsPage />);
  await userEvent.click(screen.getByRole("tab", { name: "Storage locations" }));
  await changeData();
  await userEvent.click(
    screen.getByRole("button", { name: "Change storage locations" }),
  );
  expect(screen.getByLabelText("Appearance")).toBeDisabled();
  await act(async () => {
    pending.resolve(planned);
  });
  expect(screen.getByLabelText("Appearance")).toBeEnabled();
});

test("keeps edited paths on validation failure and explains failed startup moves", async () => {
  vi.mocked(api.getStorageLocations).mockResolvedValue({
    ...original,
    moveFailed: true,
  });
  render(<StorageSettings onBusyChange={() => {}} />);
  await changeData();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "original locations remain in use",
  );
  vi.mocked(api.changeStorageLocations).mockRejectedValueOnce(
    new ApiError(422, "Invalid folder", "storage_location_invalid"),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Change storage locations" }),
  );
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  expect(
    screen.getByLabelText("Data folder (inventories and attachments)"),
  ).toHaveValue("/new/data");
});

test("uses each default path as a draft without moving files until confirmation", async () => {
  vi.mocked(api.getStorageLocations).mockResolvedValue({
    ...original,
    paths: {
      ...original.paths,
      dataDirectory: "/custom/data",
      backupsDirectory: "/custom/backups",
    },
  });
  render(<StorageSettings onBusyChange={() => {}} />);
  await screen.findByLabelText("Data folder (inventories and attachments)");
  await userEvent.click(
    screen.getByRole("button", {
      name: "Use default: Data folder (inventories and attachments)",
    }),
  );
  expect(
    screen.getByLabelText("Data folder (inventories and attachments)"),
  ).toHaveValue("/app/data");
  expect(screen.getByLabelText("Backup folder")).toHaveValue("/custom/backups");
  await userEvent.click(
    screen.getByRole("button", { name: "Use default: Backup folder" }),
  );
  expect(screen.getByLabelText("Backup folder")).toHaveValue("/app/backups");
  expect(api.changeStorageLocations).not.toHaveBeenCalled();
});

test("shows a completed live switch without requiring an application restart", async () => {
  vi.mocked(api.changeStorageLocations).mockResolvedValue({
    ...original,
    revision: 4,
    paths: { ...original.paths, dataDirectory: "/new/data" },
  });
  render(<StorageSettings onBusyChange={() => {}} />);
  await changeData();
  await userEvent.click(
    screen.getByRole("button", { name: "Change storage locations" }),
  );
  expect(
    await screen.findByText("Storage locations have been changed."),
  ).toBeVisible();
  expect(
    screen.getByLabelText("Data folder (inventories and attachments)"),
  ).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "Cancel scheduled change" }),
  ).not.toBeInTheDocument();
});
