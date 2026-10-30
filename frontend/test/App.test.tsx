import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../src/services/inventories", async (original) => ({
  ...(await original<object>()),
  getInventories: vi.fn().mockResolvedValue([
    {
      id: "inventory-1",
      name: "Cables",
      description: "Cable collection",
      configuration_revision: 1,
      created_at: "2026-10-30T10:00:00Z",
      updated_at: "2026-10-30T10:00:00Z",
    },
  ]),
}));
vi.mock("../src/services/inventoryGroups", async (original) => ({
  ...(await original<object>()),
  getInventoryGroups: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/services/inventoryFields", async (original) => ({
  ...(await original<object>()),
  getInventoryFields: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/services/inventoryItems", async (original) => ({
  ...(await original<object>()),
  getInventoryItems: vi.fn().mockResolvedValue([]),
}));
vi.mock("../src/services/inventoryEditor", async (original) => ({
  ...(await original<object>()),
  getInventoryConfiguration: vi.fn().mockResolvedValue({
    inventory: {
      id: "inventory-1",
      name: "Cables",
      description: "Cable collection",
      configuration_revision: 1,
    },
    fields: [],
  }),
}));
vi.mock("../src/services/storage", async (original) => ({
  ...(await original<object>()),
  getStorageLocations: vi.fn().mockResolvedValue({
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
  }),
}));

afterEach(cleanup);

test("loads a field deep link and navigates between lazy pages without losing unsaved settings", async () => {
  window.history.replaceState(null, "", "/inventories/inventory-1/fields");
  const { default: App } = await import("../src/App");
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );

  const editor = await screen.findByRole("dialog", { name: "Edit inventory" });
  await waitFor(() => {
    expect(window.location.pathname).toBe("/inventories/inventory-1/items");
    expect(window.location.search).toBe("?edit=fields");
  });
  await user.click(within(editor).getByRole("button", { name: "Cancel" }));
  await user.click(
    screen.getByRole("link", { name: "Inventory Manager – Go to overview" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Inventories", level: 1 }),
  ).toBeVisible();

  await user.click(screen.getByRole("link", { name: "Settings" }));
  expect(
    await screen.findByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "Storage locations" }));
  const path = await screen.findByLabelText(
    "Data folder (inventories and attachments)",
  );
  await user.clear(path);
  await user.type(path, "/new/data");
  await user.click(
    screen.getByRole("link", { name: "Inventory Manager – Go to overview" }),
  );
  expect(
    await screen.findByRole("dialog", { name: "Leave settings?" }),
  ).toBeVisible();
  expect(window.location.pathname).toBe("/settings");
  await user.click(screen.getByRole("button", { name: "Stay here" }));
  expect(path).toHaveValue("/new/data");

  await user.click(
    screen.getByRole("link", { name: "Inventory Manager – Go to overview" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Discard changes and leave" }),
  );
  expect(
    await screen.findByRole("heading", { name: "Inventories", level: 1 }),
  ).toBeVisible();
  await user.click(screen.getAllByRole("link", { name: "Cables" })[0]!);
  expect(
    await screen.findByRole("heading", { name: "Cables", level: 1 }),
  ).toBeVisible();
  expect(window.location.pathname).toBe("/inventories/inventory-1/items");
});
