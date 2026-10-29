import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createMemoryRouter,
  Link,
  Outlet,
  RouterProvider,
} from "react-router-dom";
import { SettingsPage } from "../../src/pages/SettingsPage";
import * as storage from "../../src/services/storage";
import * as schedules from "../../src/services/automaticBackups";
import * as backups from "../../src/services/backups";
import * as updates from "../../src/services/applicationUpdates";
import { automaticSchedule } from "../helpers/automaticBackups";
import { deferred } from "../helpers/inventoryArchives";
import type { CreatedBackup } from "../../src/types/backup";
import type { StorageLocationState } from "../../src/types/storage";
import licenseText from "../../../LICENSE?raw";

vi.mock("../../src/services/storage", () => ({
  getStorageLocations: vi.fn(),
  changeStorageLocations: vi.fn(),
  cancelStorageMove: vi.fn(),
}));
vi.mock("../../src/services/automaticBackups", () => ({
  getBackupSchedule: vi.fn(),
  updateBackupSchedule: vi.fn(),
}));
vi.mock("../../src/services/applicationUpdates", () => ({
  checkForUpdates: vi.fn(),
}));
vi.mock("../../src/services/backups", async (original) => ({
  ...(await original<object>()),
  listBackups: vi.fn(),
  createBackup: vi.fn(),
}));

const locations: StorageLocationState = {
  revision: 1,
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
beforeEach(() => {
  vi.mocked(storage.getStorageLocations).mockResolvedValue(
    structuredClone(locations),
  );
  vi.mocked(schedules.getBackupSchedule).mockResolvedValue(
    structuredClone(automaticSchedule),
  );
  vi.mocked(backups.listBackups).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/**
 * Render the actual settings page with a real router and an external destination.
 * @returns The router for assertions about blocked and completed navigation.
 */
function show() {
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <Link to="/inventories">Open inventories</Link>
            <Outlet />
          </>
        ),
        children: [
          { path: "/settings", element: <SettingsPage /> },
          { path: "/inventories", element: <h1>Inventories</h1> },
        ],
      },
    ],
    { initialEntries: ["/settings"] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

test("offers four keyboard-accessible sections and loads management data only when opened", async () => {
  const user = userEvent.setup();
  show();
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "General",
    "Storage locations",
    "Backups",
    "About",
  ]);
  expect(
    screen.queryByRole("tab", { name: "Templates" }),
  ).not.toBeInTheDocument();
  expect(storage.getStorageLocations).not.toHaveBeenCalled();
  expect(backups.listBackups).not.toHaveBeenCalled();
  const general = screen.getByRole("tab", { name: "General" });
  general.focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Storage locations" })).toHaveFocus();
  expect(
    await screen.findByLabelText("Data folder (inventories and attachments)"),
  ).toBeVisible();
  await user.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "About" })).toHaveFocus();
  expect(screen.getByText("Christopher Kranz")).toBeVisible();
  expect(updates.checkForUpdates).not.toHaveBeenCalled();
});

test("retains storage and backup drafts across section changes and guards leaving the page", async () => {
  const user = userEvent.setup();
  const router = show();
  await user.click(screen.getByRole("tab", { name: "Storage locations" }));
  const path = await screen.findByLabelText(
    "Data folder (inventories and attachments)",
  );
  await user.clear(path);
  await user.type(path, "/new/data");
  await user.click(screen.getByRole("tab", { name: "Backups" }));
  const retention = await screen.findByLabelText("Automatic backups to keep");
  await user.clear(retention);
  await user.type(retention, "42");
  await user.click(screen.getByRole("tab", { name: "General" }));
  await user.click(screen.getByRole("tab", { name: "Storage locations" }));
  expect(path).toBeVisible();
  expect(path).toHaveValue("/new/data");
  await user.click(screen.getByRole("tab", { name: "Backups" }));
  expect(retention).toBeVisible();
  expect(retention).toHaveValue(42);
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  await user.click(screen.getByRole("link", { name: "Open inventories" }));
  expect(screen.getByRole("dialog", { name: "Leave settings?" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/settings");
  await user.click(screen.getByRole("button", { name: "Stay here" }));
  expect(retention).toHaveValue(42);
  await user.click(screen.getByRole("link", { name: "Open inventories" }));
  await user.click(
    screen.getByRole("button", { name: "Discard changes and leave" }),
  );
  expect(router.state.location.pathname).toBe("/inventories");
  expect(storage.changeStorageLocations).not.toHaveBeenCalled();
  expect(schedules.updateBackupSchedule).not.toHaveBeenCalled();
});

test("keeps a running backup mounted and blocks leaving until it completes", async () => {
  const user = userEvent.setup();
  const pending = deferred<CreatedBackup>();
  vi.mocked(backups.createBackup).mockReturnValue(pending.promise);
  const router = show();
  await user.click(screen.getByRole("tab", { name: "Backups" }));
  await screen.findByText("No backups yet.");
  await user.click(screen.getByRole("button", { name: "Create backup" }));
  expect(screen.getByRole("tab", { name: "General" })).toBeDisabled();
  await user.click(screen.getByRole("link", { name: "Open inventories" }));
  const dialog = screen.getByRole("dialog", { name: "Leave settings?" });
  expect(
    within(dialog).getByText(/operation is still in progress/),
  ).toBeVisible();
  expect(
    within(dialog).getByRole("button", { name: "Leave settings" }),
  ).toBeDisabled();
  expect(router.state.location.pathname).toBe("/settings");
  await act(async () =>
    pending.resolve({
      id: "new-backup",
      filename: "backup.zip",
      created_at: "2026-10-29T10:00:00Z",
      byte_size: 2048,
      kind: "manual",
    }),
  );
  await waitFor(() =>
    expect(
      within(dialog).getByRole("button", { name: "Leave settings" }),
    ).toBeEnabled(),
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Leave settings" }),
  );
  expect(router.state.location.pathname).toBe("/inventories");
  expect(backups.createBackup).toHaveBeenCalledOnce();
});

test("shows the original MIT license and returns focus after dismissal", async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole("tab", { name: "About" }));
  const trigger = screen.getByRole("button", { name: "MIT" });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "MIT License" });
  expect(dialog.querySelector("pre")?.textContent).toBe(licenseText);
  expect(dialog.querySelector("pre")).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});
