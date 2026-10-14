import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import {
  SidebarContextActions,
  type SidebarContextTarget,
} from "../../src/components/SidebarContextActions";
import {
  updateInventory,
  deleteInventory,
} from "../../src/services/inventories";
import {
  updateInventoryGroup,
  deleteInventoryGroup,
} from "../../src/services/inventoryGroups";

vi.mock("../../src/services/inventories", () => ({
  updateInventory: vi.fn(),
  deleteInventory: vi.fn(),
}));
vi.mock("../../src/services/inventoryGroups", () => ({
  createInventoryGroup: vi.fn(),
  updateInventoryGroup: vi.fn(),
  deleteInventoryGroup: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const inventory = {
  id: "games",
  name: "Games",
  description: "Collection",
  group_id: null,
  created_at: "",
  updated_at: "",
};
const group = {
  id: "leisure",
  name: "Leisure",
  created_at: "",
  updated_at: "",
};

// Display the current route to verify navigation after an inventory deletion.
function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

/**
 * Render sidebar actions with an isolated query cache and a selected object.
 * @param kind The selected sidebar object type.
 * @returns The callback used to observe completed or canceled actions.
 */
function renderActions(kind: "inventory" | "group") {
  const target: SidebarContextTarget = {
    x: 10,
    y: 20,
    source: document.createElement("button"),
    ...(kind === "inventory"
      ? { kind, entry: inventory }
      : { kind, entry: group }),
  };
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/inventories/games/items"]}>
        <SidebarContextActions
          target={target}
          onClose={close}
          onOpenDialog={vi.fn()}
        />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return close;
}

// Test that context editing updates only inventory metadata.
test("edits an inventory from the context menu", async () => {
  const user = userEvent.setup();
  vi.mocked(updateInventory).mockResolvedValue(inventory);
  const close = renderActions("inventory");
  await user.click(screen.getByRole("menuitem", { name: "Edit" }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), " Board games ");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateInventory).toHaveBeenCalledWith("games", {
      name: "Board games",
      description: "Collection",
    }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

// Test that group renaming uses the persistent group endpoint.
test("renames a group from the context menu", async () => {
  const user = userEvent.setup();
  vi.mocked(updateInventoryGroup).mockResolvedValue(group);
  renderActions("group");
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.clear(screen.getByLabelText("Group name"));
  await user.type(screen.getByLabelText("Group name"), "Hobbies");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateInventoryGroup).toHaveBeenCalledWith("leisure", "Hobbies"),
  );
});

// Test that canceling confirmation makes no deletion request.
test("cancels group deletion without changing data", async () => {
  const user = userEvent.setup();
  const close = renderActions("group");
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));
  expect(
    screen.getByRole("dialog", { name: "Delete group" }),
  ).toHaveTextContent("Its inventories will be kept without a group.");
  expect(deleteInventoryGroup).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
});

// Test that confirmed group deletion never invokes inventory deletion.
test("deletes only the selected group after confirmation", async () => {
  const user = userEvent.setup();
  vi.mocked(deleteInventoryGroup).mockResolvedValue(undefined);
  renderActions("group");
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(deleteInventoryGroup).toHaveBeenCalledWith("leisure"),
  );
  expect(deleteInventory).not.toHaveBeenCalled();
  expect(screen.getByTestId("location")).toHaveTextContent(
    "/inventories/games/items",
  );
});

// Test that deleting the current inventory leaves its now-invalid route.
test("returns to the overview after deleting the open inventory", async () => {
  const user = userEvent.setup();
  vi.mocked(deleteInventory).mockResolvedValue(undefined);
  renderActions("inventory");
  await user.click(screen.getByRole("menuitem", { name: "Delete" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(deleteInventory).toHaveBeenCalledWith("games"));
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(/^\/$/),
  );
});

// Test that failed saves retain user input and leave the dialog open.
test("reports a failed group rename without losing the entered name", async () => {
  const user = userEvent.setup();
  vi.mocked(updateInventoryGroup).mockRejectedValue(
    new Error("Synthetic failure"),
  );
  const close = renderActions("group");
  await user.click(screen.getByRole("menuitem", { name: "Rename" }));
  await user.clear(screen.getByLabelText("Group name"));
  await user.type(screen.getByLabelText("Group name"), "Hobbies");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByLabelText("Group name")).toHaveValue("Hobbies");
  expect(close).not.toHaveBeenCalled();
});
