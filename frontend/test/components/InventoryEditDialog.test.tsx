import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { InventoryEditDialog } from "../../src/components/InventoryEditDialog";
import * as fieldApi from "../../src/services/inventoryFields";
import { saveInventoryConfiguration } from "../../src/services/inventoryEditor";
import { ApiError } from "../../src/services/api";
import type { InventoryField } from "../../src/types/inventoryField";

vi.mock("../../src/services/inventoryEditor", () => ({
  saveInventoryConfiguration: vi.fn(),
}));
vi.mock("../../src/services/inventoryFields", () => ({
  getInventoryFields: vi.fn(),
  createInventoryField: vi.fn(),
  updateInventoryField: vi.fn(),
  deleteInventoryField: vi.fn(),
  createInventoryFieldOption: vi.fn(),
  updateInventoryFieldOption: vi.fn(),
  deleteInventoryFieldOption: vi.fn(),
}));
const inventory = {
  id: "games",
  name: "Games",
  description: null,
  created_at: "",
  updated_at: "",
};
const title: InventoryField = {
  id: "title",
  inventory_id: inventory.id,
  name: "Title",
  field_type: "text",
  max_length: 120,
  is_required: false,
  is_sortable: true,
  options: [],
  position: 0,
  created_at: "",
  updated_at: "",
};
const type: InventoryField = {
  ...title,
  id: "type",
  name: "Type",
  field_type: "select",
  max_length: null,
  position: 1,
  options: [
    {
      id: "usb",
      field_id: "type",
      name: "USB",
      position: 0,
      created_at: "",
      updated_at: "",
    },
    {
      id: "hdmi",
      field_id: "type",
      name: "HDMI",
      position: 1,
      created_at: "",
      updated_at: "",
    },
  ],
};

beforeEach(() => {
  vi.mocked(fieldApi.getInventoryFields).mockResolvedValue([]);
  vi.mocked(saveInventoryConfiguration).mockResolvedValue({
    inventory,
    fields: [],
  });
});
afterEach(() => {
  // Every field change must go through the single explicit editor save.
  for (const action of [
    fieldApi.createInventoryField,
    fieldApi.updateInventoryField,
    fieldApi.deleteInventoryField,
    fieldApi.createInventoryFieldOption,
    fieldApi.updateInventoryFieldOption,
    fieldApi.deleteInventoryFieldOption,
  ]) {
    expect(action).not.toHaveBeenCalled();
  }
  cleanup();
  vi.resetAllMocks();
});

/**
 * Render a session with an isolated query cache.
 * @param section The initial editor section.
 * @returns The dismissal spy, cache, and rendered session.
 */
function renderEditor(section: "general" | "fields" = "general") {
  const close = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <InventoryEditDialog
        inventory={inventory}
        onClose={close}
        initialSection={section}
      />
    </QueryClientProvider>,
  );
  return { ...view, close, client };
}

/**
 * Add a text field through its local child form.
 * @param user The current test interaction session.
 * @param name The field name to enter.
 */
async function addTextField(
  user: ReturnType<typeof userEvent.setup>,
  name = "Notes",
) {
  await user.click(await screen.findByRole("button", { name: "New field" }));
  await user.type(screen.getByLabelText("Field name"), name);
  await user.click(screen.getByRole("button", { name: "Add field" }));
}

// Test that the editor never saves a configuration it has not loaded successfully.
test("waits for fields to load and allows retry after a load error", async () => {
  const user = userEvent.setup();
  vi.mocked(fieldApi.getInventoryFields).mockRejectedValueOnce(
    new ApiError(500, "Unable to load."),
  );
  renderEditor();
  expect(screen.getByRole("status")).toHaveTextContent("Loading fields");
  expect(
    screen.queryByRole("button", { name: "Save changes" }),
  ).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load.");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByLabelText("Name")).toHaveValue("Games");
});

// Test that child confirmations alter only local state and do not pollute the query cache.
test("keeps new fields local across section changes until explicit save", async () => {
  const user = userEvent.setup();
  const { client, close } = renderEditor("fields");
  await addTextField(user);
  expect(screen.getByText("Notes")).toBeInTheDocument();
  expect(client.getQueryData(["inventories", inventory.id, "fields"])).toEqual(
    [],
  );
  expect(saveInventoryConfiguration).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "General" }));
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Collection");
  await user.click(screen.getByRole("button", { name: "Fields" }));
  expect(screen.getByText("Notes")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(saveInventoryConfiguration).toHaveBeenCalledWith("games", {
      inventory: { name: "Collection", description: null },
      fields: [
        {
          action: "create",
          data: {
            name: "Notes",
            field_type: "text",
            max_length: 255,
            is_required: false,
            is_sortable: true,
          },
        },
      ],
      options: [],
    }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

// Test every parent dismissal path and a fresh session after discarding local additions.
test.each(["Cancel", "Close dialog", "Escape", "Backdrop"])(
  "discards the session through %s",
  async (method) => {
    const user = userEvent.setup();
    const view = renderEditor("fields");
    await addTextField(user);
    if (method === "Escape") await user.keyboard("{Escape}");
    else if (method === "Backdrop") {
      const overlay = screen.getByRole("dialog", {
        name: "Edit inventory",
      }).parentElement!;
      await user.click(overlay);
    } else await user.click(screen.getByRole("button", { name: method }));
    expect(view.close).toHaveBeenCalledOnce();
    expect(saveInventoryConfiguration).not.toHaveBeenCalled();
    view.unmount();
    renderEditor("fields");
    expect(
      await screen.findByText("No fields configured yet."),
    ).toBeInTheDocument();
  },
);

// Test mixed changes to saved objects while preserving identifiers and untouched configuration.
test("submits field renames and option changes together", async () => {
  const user = userEvent.setup();
  vi.mocked(fieldApi.getInventoryFields).mockResolvedValue([title, type]);
  const before = JSON.stringify([title, type]);
  const view = renderEditor("fields");
  const titleRow = (await screen.findByText("Title")).closest("article")!;
  await user.click(within(titleRow).getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByLabelText("Field name"));
  await user.type(screen.getByLabelText("Field name"), "Cable");
  await user.click(screen.getByRole("button", { name: "Save" }));
  const usbRow = screen.getByText("USB").closest("li")!;
  await user.click(within(usbRow).getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByLabelText("Option name"));
  await user.type(screen.getByLabelText("Option name"), "USB-C");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await user.click(
    within(screen.getByText("HDMI").closest("li")!).getByRole("button", {
      name: "Delete",
    }),
  );
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete option" })).getByRole(
      "button",
      { name: "Delete" },
    ),
  );
  await user.type(screen.getByLabelText("New option name"), "DisplayPort");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(saveInventoryConfiguration).not.toHaveBeenCalled();
  expect(JSON.stringify([title, type])).toBe(before);
  expect(
    view.client.getQueryData(["inventories", inventory.id, "fields"]),
  ).toEqual([title, type]);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(saveInventoryConfiguration).toHaveBeenCalledWith("games", {
      inventory: { name: "Games", description: null },
      fields: [
        { action: "update", field_id: "title", data: { name: "Cable" } },
      ],
      options: [
        { action: "delete", field_id: "type", option_id: "hdmi" },
        {
          action: "update",
          field_id: "type",
          option_id: "usb",
          data: { name: "USB-C" },
        },
        { action: "create", field_id: "type", data: { name: "DisplayPort" } },
      ],
    }),
  );
});

// Test field settings remain local until saving the parent, or are discarded on cancellation.
test.each(["Save changes", "Cancel"])(
  "keeps field settings in the session until %s",
  async (action) => {
    const user = userEvent.setup();
    vi.mocked(fieldApi.getInventoryFields).mockResolvedValue([title]);
    const { client, close } = renderEditor("fields");
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("checkbox", { name: "Required field" }));
    await user.click(
      screen.getByRole("checkbox", { name: "Allow column sorting" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Required field")).toBeVisible();
    expect(screen.getByText("Sorting disabled")).toBeVisible();
    expect(saveInventoryConfiguration).not.toHaveBeenCalled();
    expect(
      client.getQueryData(["inventories", inventory.id, "fields"]),
    ).toEqual([title]);
    await user.click(screen.getByRole("button", { name: action }));
    if (action === "Save changes") {
      await waitFor(() =>
        expect(saveInventoryConfiguration).toHaveBeenCalledWith("games", {
          inventory: { name: "Games", description: null },
          fields: [
            {
              action: "update",
              field_id: title.id,
              data: { is_required: true, is_sortable: false },
            },
          ],
          options: [],
        }),
      );
    } else expect(saveInventoryConfiguration).not.toHaveBeenCalled();
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(title.is_required).toBe(false);
    expect(title.is_sortable).toBe(true);
  },
);

// Test that deleting a saved field only stages a tombstone operation.
test("stages saved field deletion without changing the cached field list", async () => {
  const user = userEvent.setup();
  vi.mocked(fieldApi.getInventoryFields).mockResolvedValue([title]);
  const { client } = renderEditor("fields");
  await user.click(await screen.findByRole("button", { name: "Delete" }));
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Delete inventory field" }),
    ).getByRole("button", { name: "Delete" }),
  );
  expect(screen.queryByText("Title")).not.toBeInTheDocument();
  expect(client.getQueryData(["inventories", inventory.id, "fields"])).toEqual([
    title,
  ]);
  expect(saveInventoryConfiguration).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(saveInventoryConfiguration).toHaveBeenCalledWith("games", {
      inventory: { name: "Games", description: null },
      fields: [{ action: "delete", field_id: "title" }],
      options: [],
    }),
  );
});

// Test that adding then deleting an unsaved field produces no database operation.
test("drops discarded new fields from the save payload", async () => {
  const user = userEvent.setup();
  renderEditor("fields");
  await addTextField(user);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Delete inventory field" }),
    ).getByRole("button", { name: "Delete" }),
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(saveInventoryConfiguration).toHaveBeenCalledWith("games", {
      inventory: { name: "Games", description: null },
      fields: [],
      options: [],
    }),
  );
});

// Test that options of an unsaved selection field remain part of its local creation draft.
test("keeps options on new selection fields local and saves only their final state", async () => {
  const user = userEvent.setup();
  renderEditor("fields");
  await user.click(await screen.findByRole("button", { name: "New field" }));
  await user.type(screen.getByLabelText("Field name"), "Status");
  await user.selectOptions(screen.getByLabelText("Field type"), "select");
  await user.type(screen.getByLabelText("Option 1"), "Backlog");
  await user.click(screen.getByRole("button", { name: "Add field" }));
  await user.click(
    within(screen.getByText("Backlog").closest("li")!).getByRole("button", {
      name: "Delete",
    }),
  );
  await user.click(
    within(screen.getByRole("dialog", { name: "Delete option" })).getByRole(
      "button",
      { name: "Delete" },
    ),
  );
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent("New selection fields");
  await user.type(screen.getByLabelText("New option name"), "Playing");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.click(screen.getByRole("button", { name: "General" }));
  await user.click(screen.getByRole("button", { name: "Fields" }));
  expect(screen.getByText("Playing")).toBeInTheDocument();
  expect(saveInventoryConfiguration).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(saveInventoryConfiguration).toHaveBeenCalledWith("games", {
      inventory: { name: "Games", description: null },
      fields: [
        {
          action: "create",
          data: {
            name: "Status",
            field_type: "select",
            is_required: false,
            is_sortable: true,
            options: [{ name: "Playing" }],
          },
        },
      ],
      options: [],
    }),
  );
});

// Test that a failed atomic save retains every edit and supports an identical retry.
test("keeps the draft after an error and retries without duplicate additions", async () => {
  const user = userEvent.setup();
  vi.mocked(saveInventoryConfiguration).mockRejectedValueOnce(
    new ApiError(500, "Save failed."),
  );
  const { close } = renderEditor("fields");
  await addTextField(user);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save failed.");
  expect(screen.getByText("Notes")).toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  const calls = vi.mocked(saveInventoryConfiguration).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual(calls[0]);
});

// Test that all field controls and dismissal are blocked during the actual save.
test("blocks edits and dismissal while saving", async () => {
  const user = userEvent.setup();
  vi.mocked(saveInventoryConfiguration).mockImplementation(
    () => new Promise<never>(() => {}),
  );
  const { close } = renderEditor("fields");
  await screen.findByRole("button", { name: "New field" });
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "New field" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(close).not.toHaveBeenCalled();
});

// Test that background query refreshes cannot reset an active session.
test("preserves the session snapshot across background field refetches", async () => {
  const user = userEvent.setup();
  const { client } = renderEditor("fields");
  await addTextField(user);
  act(() =>
    client.setQueryData(["inventories", inventory.id, "fields"], [title]),
  );
  expect(screen.getByText("Notes")).toBeInTheDocument();
  expect(screen.queryByText("Title")).not.toBeInTheDocument();
});

// Test Escape handling for nested dialogs and the unfinished-form guard.
test("only closes the child dialog on Escape", async () => {
  const user = userEvent.setup();
  const { close } = renderEditor("fields");
  await user.click(await screen.findByRole("button", { name: "New field" }));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  expect(close).not.toHaveBeenCalled();
});

// Test that large drafts keep the independent field-list scroll layout.
test("keeps a long field list independently scrollable", async () => {
  vi.mocked(fieldApi.getInventoryFields).mockResolvedValue(
    Array.from({ length: 25 }, (_, i) => ({
      ...title,
      id: "field-" + i,
      name: "Field " + i,
    })),
  );
  renderEditor("fields");
  const list = await screen.findByRole("list", { name: "Inventory fields" });
  expect(list.children).toHaveLength(25);
  expect(list).toHaveClass("overflow-y-auto", "min-h-0");
  expect(list).not.toContainElement(
    screen.getByRole("button", { name: "Save changes" }),
  );
});
