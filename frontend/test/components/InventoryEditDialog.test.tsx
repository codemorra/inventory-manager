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

// Test that only the field list receives independent scrolling while actions stay outside it.
test("contains a long field list in its own scroll area outside the dialog actions", async () => {
  vi.mocked(getInventoryFields).mockResolvedValue(
    Array.from({ length: 25 }, (_, index) => ({
      id: `field-${index}`,
      inventory_id: inventory.id,
      name: `Field ${index + 1}`,
      field_type: "text" as const,
      max_length: 255,
      options: [],
      position: index,
      created_at: "",
      updated_at: "",
    })),
  );
  renderEditor("fields");
  const list = await screen.findByRole("list", { name: "Inventory fields" });
  expect(list.children).toHaveLength(25);
  expect(list).toHaveClass("overflow-y-auto", "min-h-0");
  expect(list).toHaveAttribute("tabindex", "0");
  expect(list).not.toContainElement(
    screen.getByRole("button", { name: "Cancel" }),
  );
  expect(list).not.toContainElement(
    screen.getByRole("button", { name: "Save changes" }),
  );
  expect(list).not.toContainElement(
    screen.getByRole("button", { name: "New field" }),
  );
  expect(screen.getByRole("dialog", { name: "Edit inventory" })).toHaveClass(
    "max-h-[90dvh]",
    "overflow-y-auto",
  );
});

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

// Test that the shared footer can dismiss field configuration without saving metadata.
test("cancels from the fields section without saving metadata", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryFields).mockResolvedValue([]);
  const close = renderEditor("fields");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
  expect(updateInventory).not.toHaveBeenCalled();
});

// Test that the shared footer saves general edits even while fields are displayed.
test("saves metadata changes from the fields section", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryFields).mockResolvedValue([]);
  vi.mocked(updateInventory).mockResolvedValue({
    ...inventory,
    name: "Board games",
  });
  const close = renderEditor();
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Board games");
  await user.click(screen.getByRole("button", { name: "Fields" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(updateInventory).toHaveBeenCalledWith("games", {
      name: "Board games",
      description: null,
    }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

// Test that failed saves remain visible outside the general settings form.
test("shows save errors in the fields section", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryFields).mockResolvedValue([]);
  vi.mocked(updateInventory).mockRejectedValue(new Error("Synthetic failure"));
  const close = renderEditor("fields");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
});

// Test that dismissal is blocked while metadata is being saved from the fields section.
test("disables footer actions while saving from the fields section", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryFields).mockResolvedValue([]);
  vi.mocked(updateInventory).mockImplementation(
    () => new Promise<never>(() => {}),
  );
  const close = renderEditor("fields");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(close).not.toHaveBeenCalled();
});

// Test that canceling field deletion leaves the parent inventory editor open.
test("Escape cancels field deletion without closing the inventory editor", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryFields).mockResolvedValue([
    {
      id: "title",
      inventory_id: inventory.id,
      name: "Title",
      field_type: "text",
      max_length: 255,
      options: [],
      position: 0,
      created_at: "",
      updated_at: "",
    },
  ]);
  const close = renderEditor("fields");
  await user.click(await screen.findByRole("button", { name: "Delete" }));
  expect(
    screen.getByRole("dialog", { name: "Delete inventory field" }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  await user.keyboard("{Escape}");
  expect(
    screen.queryByRole("dialog", { name: "Delete inventory field" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Edit inventory" }),
  ).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
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
  expect(updateInventory).not.toHaveBeenCalled();
});
