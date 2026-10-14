import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { InventoryEditDialog } from "../../src/components/InventoryEditDialog";
import {
  createInventoryField,
  getInventoryFields,
} from "../../src/services/inventoryFields";
import { updateInventory } from "../../src/services/inventories";

vi.mock("../../src/services/inventories", () => ({ updateInventory: vi.fn() }));
vi.mock("../../src/services/inventoryFields", () => ({
  createInventoryField: vi.fn(),
  getInventoryFields: vi.fn(),
  updateInventoryField: vi.fn(),
  deleteInventoryField: vi.fn(),
}));
const inventory = {
  id: "games",
  name: "Games",
  description: null,
  created_at: "",
  updated_at: "",
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/**
 * Open the editor with an isolated cache.
 * @param initialSection The section to display initially.
 * @returns The callback observing editor dismissal.
 */
function renderEditor(initialSection: "general" | "fields" = "general") {
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <InventoryEditDialog
        inventory={inventory}
        onClose={close}
        initialSection={initialSection}
      />
    </QueryClientProvider>,
  );
  return close;
}

// Test that switching sections does not discard unsaved general settings.
test("keeps metadata edits when switching between general settings and fields", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryFields).mockResolvedValue([]);
  renderEditor();
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Board games");
  await user.click(screen.getByRole("button", { name: "Fields" }));
  expect(
    await screen.findByText("No fields configured yet."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New field" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "General" }));
  expect(screen.getByLabelText("Name")).toHaveValue("Board games");
  expect(updateInventory).not.toHaveBeenCalled();
});

// Test that canceling a child form leaves the inventory editor open.
test("Escape closes the new field dialog without closing the editor", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryFields).mockResolvedValue([]);
  const close = renderEditor("fields");
  await user.click(screen.getByRole("button", { name: "New field" }));
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  await user.keyboard("{Escape}");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(
    screen.getByRole("dialog", { name: "Edit inventory" }),
  ).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
});

// Test that field changes use the existing mutation and immediately refresh the editor.
test("creates a field from the editor", async () => {
  const user = userEvent.setup();
  const field = {
    id: "title",
    inventory_id: "games",
    name: "Title",
    field_type: "text" as const,
    max_length: 255,
    options: [],
    position: 0,
    created_at: "",
    updated_at: "",
  };
  vi.mocked(getInventoryFields)
    .mockResolvedValueOnce([])
    .mockResolvedValue([field]);
  vi.mocked(createInventoryField).mockResolvedValue(field);
  renderEditor("fields");
  await screen.findByText("No fields configured yet.");
  await user.click(screen.getByRole("button", { name: "New field" }));
  await user.type(screen.getByLabelText("Field name"), "Title");
  await user.click(screen.getByRole("button", { name: "Add field" }));
  await waitFor(() => expect(createInventoryField).toHaveBeenCalled());
  expect(await screen.findByText("Title")).toBeInTheDocument();
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
});
