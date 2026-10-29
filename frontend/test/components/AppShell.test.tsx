import {
  prepareInventoryExport,
  discardInventoryExport,
  downloadInventoryExport,
} from "../../src/services/inventoryArchives";
import { archiveExport } from "../helpers/inventoryArchives";
vi.mock("../../src/services/inventoryArchives", async (actual) => ({
  ...(await actual<object>()),
  prepareInventoryExport: vi.fn(),
  discardInventoryExport: vi.fn(),
  downloadInventoryExport: vi.fn(),
}));
vi.mock("../../src/services/inventoryFields", () => ({
  getInventoryFields: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../src/services/inventoryEditor", () => ({
  getInventoryConfiguration: vi.fn(async () => ({
    inventory: (await getInventories())[0],
    fields: [],
  })),
  saveInventoryConfiguration: vi.fn(),
}));
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SettingsPage } from "../../src/pages/SettingsPage";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AppShell } from "../../src/components/layout/AppShell";
import { getInventories } from "../../src/services/inventories";
import * as backups from "../../src/services/backups";
import { dataChangedEvent } from "../../src/services/api";

vi.mock("../../src/services/inventories", () => ({
  createInventory: vi.fn(),
  getInventories: vi.fn(),
  updateInventory: vi.fn(),
  deleteInventory: vi.fn(),
}));

const mockedGetInventories = vi.mocked(getInventories);
vi.mock("../../src/services/inventoryGroups", () => ({
  getInventoryGroups: vi.fn().mockResolvedValue([]),
  createInventoryGroup: vi.fn(),
  updateInventoryGroup: vi.fn(),
  deleteInventoryGroup: vi.fn(),
}));

afterEach(cleanup);

/**
 * Render the application shell with isolated data and an initial route.
 * @param initialPath The route shown before navigation.
 * @returns The rendered application shell.
 */
function renderAppShell(initialPath = "/") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AppShell>
          <Routes>
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<h1>Page content</h1>} />
          </Routes>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

test.each([false, true])(
  "opens the overview through the application header (mobile: %s)",
  async (mobile) => {
    const user = userEvent.setup();
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell("/templates");
    if (mobile)
      await user.click(screen.getByRole("button", { name: "Open menu" }));
    const scope = mobile
      ? within(screen.getByRole("dialog", { name: "Mobile navigation" }))
      : screen;
    const header = scope.getByRole("link", {
      name: "Inventory Manager – Go to overview",
    });
    expect(header).toHaveAttribute("href", "/");
    expect(header).toHaveAttribute("title", "Go to overview");
    expect(header).not.toHaveAttribute("aria-current");
    if (mobile) await user.click(header);
    else {
      header.focus();
      await user.keyboard("{Enter}");
    }
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Inventory Manager – Go to overview" }),
    ).toHaveAttribute("aria-current", "page");
  },
);

test("requires a reload after another session replaces the application data", async () => {
  mockedGetInventories.mockResolvedValue([]);
  const reload = vi
    .spyOn(backups, "reloadAfterRestore")
    .mockImplementation(() => {});
  try {
    renderAppShell();
    fireEvent(window, new Event(dataChangedEvent));
    const dialog = await screen.findByRole("dialog", {
      name: "Data has changed",
    });
    expect(dialog).toHaveTextContent(
      "Reload the application before continuing",
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(dialog).toBeVisible();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Reload application" }),
    );
    expect(reload).toHaveBeenCalledOnce();
  } finally {
    reload.mockRestore();
  }
});

describe("AppShell", () => {
  // Test the complete right-click-to-edit flow through the actual sidebar.
  test("opens inventory actions from a sidebar right click", async () => {
    const user = userEvent.setup();
    mockedGetInventories.mockResolvedValue([
      {
        configuration_revision: 1,
        id: "games",
        name: "Games",
        description: "Collection",
        created_at: "",
        updated_at: "",
      },
    ]);
    renderAppShell();
    const link = await screen.findByRole("link", { name: "Games" });
    fireEvent.contextMenu(link, { clientX: 100, clientY: 200 });
    expect(
      screen.getByRole("menu", { name: "Actions for Games" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Edit inventory" }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText("Name")).toHaveValue("Games");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(link).toHaveFocus();
  });

  // Test that group creation replaces mobile navigation with a single dialog.
  test("opens group creation from mobile navigation", async () => {
    const user = userEvent.setup();
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const navigation = screen.getByRole("dialog", {
      name: "Mobile navigation",
    });
    await user.click(within(navigation).getByRole("button", { name: "New" }));
    await user.click(screen.getByRole("menuitem", { name: "New group" }));
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "New group" }),
    ).toBeInTheDocument();
  });

  // Test that language is configured in settings and changes the full interface.
  test("opens settings and changes the application language", async () => {
    const user = userEvent.setup();
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();

    expect(screen.queryByLabelText("Language")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Appearance")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Blue" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Settings" }));
    expect(
      screen.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Appearance")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(document.documentElement.dataset.accent).toBe("blue");
    await user.selectOptions(screen.getByLabelText("Language"), "de");
    expect(
      screen.getByRole("heading", { name: "Einstellungen", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // Test that opening settings closes the mobile navigation overlay.
  test("opens settings from mobile navigation", async () => {
    const user = userEvent.setup();
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    const navigation = screen.getByRole("dialog", {
      name: "Mobile navigation",
    });
    await user.click(
      within(navigation).getByRole("link", { name: "Settings" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Settings", level: 1 }),
    ).toBeInTheDocument();
  });

  // Test that the shell displays its primary regions and accessibility link
  test("renders application navigation and page content", () => {
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();

    expect(screen.getByText("Inventory Manager")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Page content" })).toBeVisible();
    expect(
      within(screen.getByRole("complementary")).getByRole("link", {
        name: "Settings",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", "#page-content");
  });

  // Test that users can open and close the navigation on small screens
  test("opens and closes the mobile navigation", async () => {
    const user = userEvent.setup();
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const dialog = screen.getByRole("dialog", { name: "Mobile navigation" });
    expect(dialog).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Close menu" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
  });

  // Test that inventories are available directly from the sidebar
  test("renders inventory navigation links", async () => {
    mockedGetInventories.mockResolvedValue([
      {
        configuration_revision: 1,
        id: "inventory-1",
        name: "Games",
        description: null,
        created_at: "2026-10-13T10:00:00Z",
        updated_at: "2026-10-13T10:00:00Z",
      },
    ]);

    renderAppShell();

    expect(await screen.findByRole("link", { name: "Games" })).toHaveAttribute(
      "href",
      "/inventories/inventory-1/items",
    );
  });
});

// The separate management entry sits above Settings and closes mobile navigation when followed.
test.each([false, true])(
  "opens templates from the sidebar footer (mobile: %s)",
  async (mobile) => {
    const user = userEvent.setup();
    mockedGetInventories.mockResolvedValue([]);
    renderAppShell();
    if (mobile)
      await user.click(screen.getByRole("button", { name: "Open menu" }));
    const area = mobile
      ? within(screen.getByRole("dialog", { name: "Mobile navigation" }))
      : screen;
    const link = area.getByRole("link", { name: "Templates" });
    expect(link).toHaveAttribute("href", "/templates");
    expect(link.nextElementSibling).toHaveTextContent("Settings");
    await user.click(link);
    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Templates" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  },
);

// Import is shell-owned so dismissing mobile navigation does not unmount the import dialog.
test("opens import from the creation menu and replaces mobile navigation", async () => {
  const user = userEvent.setup();
  mockedGetInventories.mockResolvedValue([]);
  renderAppShell();
  await user.click(screen.getByRole("button", { name: "Open menu" }));
  const mobile = screen.getByRole("dialog", { name: "Mobile navigation" });
  await user.click(within(mobile).getByRole("button", { name: "New" }));
  await user.click(screen.getByRole("menuitem", { name: "Import inventory" }));
  expect(
    screen.queryByRole("dialog", { name: "Mobile navigation" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Import inventory" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Archive file (.zip)")).toHaveFocus();
});

// Dirty inventory settings propagate a lock to sibling sidebar actions until dismissal.
test("disables archive actions while inventory settings have unsaved changes", async () => {
  const user = userEvent.setup();
  mockedGetInventories.mockResolvedValue([
    {
      configuration_revision: 1,
      id: "games",
      name: "Games",
      description: null,
      created_at: "",
      updated_at: "",
    },
  ]);
  renderAppShell();
  const link = await screen.findByRole("link", { name: "Games" });
  fireEvent.contextMenu(link, { clientX: 100, clientY: 200 });
  await user.click(screen.getByRole("menuitem", { name: "Edit" }));
  await user.type(await screen.findByLabelText("Name"), " changed");
  await user.click(screen.getByRole("button", { name: "New" }));
  expect(
    screen.getByRole("menuitem", { name: "Import inventory" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "New" }));
  expect(
    screen.getByRole("menuitem", { name: "Import inventory" }),
  ).toBeEnabled();
});

// The actual sidebar context action opens preparation and hands only its completed artifact to native download.
test("exports the right-clicked inventory through the actual sidebar action flow", async () => {
  const user = userEvent.setup();
  mockedGetInventories.mockResolvedValue([
    {
      configuration_revision: 1,
      id: "games",
      name: "Games",
      description: null,
      created_at: "",
      updated_at: "",
    },
  ]);
  vi.mocked(prepareInventoryExport).mockResolvedValue({
    ...archiveExport,
    filename: "Games.zip",
  });
  vi.mocked(discardInventoryExport).mockResolvedValue(undefined);
  renderAppShell();
  const source = await screen.findByRole("link", { name: "Games" });
  fireEvent.contextMenu(source, { clientX: 100, clientY: 200 });
  await user.click(screen.getByRole("menuitem", { name: "Export inventory" }));
  expect(
    screen.getByRole("dialog", { name: "Export inventory" }),
  ).toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "Download ZIP" }));
  expect(downloadInventoryExport).toHaveBeenCalledWith("games", {
    ...archiveExport,
    filename: "Games.zip",
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(source).toHaveFocus();
});
