import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InventoryEditDialog } from "../../src/components/InventoryEditDialog";
import * as fieldApi from "../../src/services/inventoryFields";
import {
  saveInventoryConfiguration,
  getInventoryConfiguration,
} from "../../src/services/inventoryEditor";
import { ApiError } from "../../src/services/api";
import type { InventoryField } from "../../src/types/inventoryField";
import { selectFieldType } from "../helpers/inventoryDraft";
import {
  dragField,
  fieldDragEvent,
  startFieldDrag,
} from "../helpers/fieldDrag";

vi.mock("../../src/services/inventoryEditor", () => ({
  saveInventoryConfiguration: vi.fn(),
  getInventoryConfiguration: vi.fn(),
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
  configuration_revision: 1,
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
  vi.mocked(getInventoryConfiguration).mockImplementation(async () => ({
    inventory,
    fields: await fieldApi.getInventoryFields(inventory.id),
  }));
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

// Test that row order stays local across tabs and becomes the saved field query order only on save.
test("saves a dragged field order without touching item data or the query cache beforehand", async () => {
  const user = userEvent.setup();
  vi.mocked(fieldApi.getInventoryFields).mockResolvedValue([title, type]);
  const { client, close } = renderEditor("fields");
  await screen.findByText("Title");
  dragField(
    screen.getByText("Type").closest("li")!,
    screen.getByText("Title").closest("li")!,
    "before",
  );
  const list = screen.getByRole("list", { name: "Inventory fields" });
  expect(
    within(list)
      .getAllByRole("heading")
      .map((heading) => heading.textContent),
  ).toEqual(["Type", "Title"]);
  expect(saveInventoryConfiguration).not.toHaveBeenCalled();
  expect(client.getQueryData(["inventories", inventory.id, "fields"])).toEqual([
    title,
    type,
  ]);
  await user.click(screen.getByRole("button", { name: "General" }));
  await user.click(screen.getByRole("button", { name: "Fields" }));
  const reordered = [
    { ...type, position: 0 },
    { ...title, position: 1 },
  ];
  vi.mocked(saveInventoryConfiguration).mockResolvedValue({
    inventory,
    fields: reordered,
  });
  vi.mocked(fieldApi.getInventoryFields).mockResolvedValue(reordered);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(saveInventoryConfiguration).toHaveBeenCalledWith("games", {
      expected_revision: 1,
      inventory: { name: "Games", description: null },
      fields: [],
      options: [],
      field_order: [{ field_id: type.id }, { field_id: title.id }],
    }),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(client.getQueryData(["inventories", inventory.id, "fields"])).toEqual(
    reordered,
  );
});

// Test Escape cancels a live preview without closing the inventory editor or modifying its draft.
test("cancels only the active field drag when Escape is pressed", async () => {
  vi.mocked(fieldApi.getInventoryFields).mockResolvedValue([title, type]);
  const { close } = renderEditor("fields");
  await screen.findByText("Title");
  const source = screen.getByText("Type").closest("li")!;
  const target = screen.getByText("Title").closest("li")!;
  const transfer = startFieldDrag(source);
  fieldDragEvent("dragOver", target, transfer, "before");
  const list = screen.getByRole("list", { name: "Inventory fields" });
  expect(
    within(list)
      .getAllByRole("heading")
      .map((heading) => heading.textContent),
  ).toEqual(["Type", "Title"]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  expect(saveInventoryConfiguration).not.toHaveBeenCalled();
  expect(
    within(list)
      .getAllByRole("heading")
      .map((heading) => heading.textContent),
  ).toEqual(["Title", "Type"]);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledOnce();
});

// Test that canceling a drag-edited session discards its order rather than leaking into a new session.
test("discards an unsaved field order when canceling the inventory editor", async () => {
  const user = userEvent.setup();
  vi.mocked(fieldApi.getInventoryFields).mockResolvedValue([title, type]);
  const view = renderEditor("fields");
  await screen.findByText("Title");
  dragField(
    screen.getByText("Type").closest("li")!,
    screen.getByText("Title").closest("li")!,
    "before",
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(saveInventoryConfiguration).not.toHaveBeenCalled();
  expect(view.close).toHaveBeenCalledOnce();
  view.unmount();
  renderEditor("fields");
  const list = await screen.findByRole("list", { name: "Inventory fields" });
  expect(
    within(list)
      .getAllByRole("heading")
      .map((heading) => heading.textContent),
  ).toEqual(["Title", "Type"]);
});

// Test temporary-field references and an identical retry after a failed combined create/reorder save.
test("retries a mixed new-field reorder without replacing temporary identifiers", async () => {
  const user = userEvent.setup();
  vi.mocked(fieldApi.getInventoryFields).mockResolvedValue([title, type]);
  vi.mocked(saveInventoryConfiguration).mockRejectedValueOnce(
    new ApiError(500, "Save failed."),
  );
  renderEditor("fields");
  await addTextField(user);
  dragField(
    screen.getByText("Notes").closest("li")!,
    screen.getByText("Title").closest("li")!,
    "before",
  );
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Save failed.");
  expect(
    within(screen.getByRole("list", { name: "Inventory fields" }))
      .getAllByRole("heading")
      .map((heading) => heading.textContent),
  ).toEqual(["Notes", "Title", "Type"]);
  const first = vi.mocked(saveInventoryConfiguration).mock.calls[0]?.[1];
  expect(first?.field_order).toEqual([
    { client_id: expect.any(String) },
    { field_id: title.id },
    { field_id: type.id },
  ]);
  expect(first?.fields).toEqual([
    {
      action: "create",
      client_id: expect.any(String),
      data: {
        name: "Notes",
        field_type: "text",
        max_length: 255,
        is_required: false,
        is_sortable: true,
      },
    },
  ]);
  const created = first?.fields[0];
  expect(created?.action === "create" && first?.field_order?.[0]).toEqual({
    client_id: created?.action === "create" ? created.client_id : undefined,
  });
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(saveInventoryConfiguration).toHaveBeenCalledTimes(2),
  );
  expect(vi.mocked(saveInventoryConfiguration).mock.calls[1]?.[1]).toEqual(
    first,
  );
});

// Test that an unfinished child form disables native field drags until it is dismissed.
test("blocks field dragging while a child editor has unfinished input", async () => {
  const user = userEvent.setup();
  vi.mocked(fieldApi.getInventoryFields).mockResolvedValue([title, type]);
  renderEditor("fields");
  await user.click(await screen.findByRole("button", { name: "New field" }));
  expect(screen.getByRole("button", { name: "Reorder Title" })).toHaveAttribute(
    "draggable",
    "false",
  );
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "Reorder Title" })).toHaveAttribute(
    "draggable",
    "true",
  );
});

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
      expected_revision: 1,
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

// Test that options are hidden from the field overview and dismissed child edits never leak.
test.each(["Cancel", "Close dialog", "Escape", "Backdrop"])(
  "discards field option changes through %s",
  async (method) => {
    const user = userEvent.setup();
    vi.mocked(fieldApi.getInventoryFields).mockResolvedValue([type]);
    renderEditor("fields");
    await screen.findByText("Type");
    expect(screen.queryByText("USB")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New option name")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit inventory field" });
    expect(dialog.querySelector("form form")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("New option name"), "Discarded");
    expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Discarded")).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: "Edit inventory field" }),
    ).toBeVisible();
    const usbRow = screen.getByText("USB").closest("li")!;
    await user.click(within(usbRow).getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Option name"));
    await user.type(screen.getByLabelText("Option name"), "Renamed{Enter}");
    if (method === "Escape") await user.keyboard("{Escape}");
    else if (method === "Backdrop") fireEvent.mouseDown(dialog.parentElement!);
    else await user.click(within(dialog).getByRole("button", { name: method }));
    expect(
      screen.queryByRole("dialog", { name: "Edit inventory field" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("USB")).toBeVisible();
    expect(screen.queryByText("Renamed")).not.toBeInTheDocument();
    expect(screen.queryByText("Discarded")).not.toBeInTheDocument();
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Edit inventory field" }),
      ).getByRole("button", { name: "Save" }),
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(saveInventoryConfiguration).toHaveBeenCalledWith("games", {
        expected_revision: 1,
        inventory: { name: "Games", description: null },
        fields: [],
        options: [],
      }),
    );
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
  await user.click(
    within(screen.getByText("Type").closest("article")!).getByRole("button", {
      name: "Edit",
    }),
  );
  const usbRow = screen.getByText("USB").closest("li")!;
  await user.click(within(usbRow).getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByLabelText("Option name"));
  await user.type(screen.getByLabelText("Option name"), "USB-C");
  await user.click(within(usbRow).getByRole("button", { name: "Save" }));
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
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Edit inventory field" }),
    ).getByRole("button", { name: "Save" }),
  );
  expect(saveInventoryConfiguration).not.toHaveBeenCalled();
  expect(JSON.stringify([title, type])).toBe(before);
  expect(
    view.client.getQueryData(["inventories", inventory.id, "fields"]),
  ).toEqual([title, type]);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(saveInventoryConfiguration).toHaveBeenCalledWith("games", {
      expected_revision: 1,
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
          expected_revision: 1,
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
      expected_revision: 1,
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
      expected_revision: 1,
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
  await selectFieldType(user, "select");
  await user.type(screen.getByLabelText("Option 1"), "Backlog");
  await user.click(screen.getByRole("button", { name: "Add field" }));
  await user.click(screen.getByRole("button", { name: "Edit" }));
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
  await user.type(screen.getByLabelText("New option name"), "Playing");
  await user.click(screen.getByRole("button", { name: "Add" }));
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Edit inventory field" }),
    ).getByRole("button", { name: "Save" }),
  );
  await user.click(screen.getByRole("button", { name: "General" }));
  await user.click(screen.getByRole("button", { name: "Fields" }));
  expect(screen.queryByText("Playing")).not.toBeInTheDocument();
  expect(saveInventoryConfiguration).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(saveInventoryConfiguration).toHaveBeenCalledWith("games", {
      expected_revision: 1,
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

// Test stale metadata and definitions remain local until an explicit, successful discard-and-reload.
test("preserves a conflicting draft through a failed reload and saves only with the refreshed revision", async () => {
  const user = userEvent.setup();
  const initial = {
    inventory: {
      ...inventory,
      name: "Snapshot name",
      configuration_revision: 7,
    },
    fields: [title],
  };
  vi.mocked(getInventoryConfiguration).mockResolvedValue(initial);
  vi.mocked(saveInventoryConfiguration).mockRejectedValueOnce(
    new ApiError(409, "Stale draft", "inventory_configuration_conflict"),
  );
  const { client, close } = renderEditor();
  const name = await screen.findByLabelText("Name");
  expect(name).toHaveValue("Snapshot name");
  await user.clear(name);
  await user.type(name, "Local draft");
  await user.click(screen.getByRole("button", { name: "Fields" }));
  await addTextField(user, "Local field");
  act(() =>
    client.setQueryData(["inventories", inventory.id, "configuration"], {
      inventory: {
        ...inventory,
        name: "Background change",
        configuration_revision: 8,
      },
      fields: [type],
    }),
  );
  expect(screen.getByText("Local field")).toBeInTheDocument();
  expect(screen.getByText("Title")).toBeInTheDocument();
  expect(screen.queryByText("Type")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your draft is preserved",
  );
  expect(saveInventoryConfiguration).toHaveBeenLastCalledWith(
    inventory.id,
    expect.objectContaining({
      expected_revision: 7,
      inventory: { name: "Local draft", description: null },
    }),
  );
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(close).not.toHaveBeenCalled();
  vi.mocked(getInventoryConfiguration).mockRejectedValueOnce(
    new Error("Offline"),
  );
  await user.click(
    screen.getByRole("button", { name: "Discard draft and reload" }),
  );
  await screen.findByText(
    "The current configuration could not be loaded. Your draft is preserved.",
  );
  expect(screen.getByText("Local field")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "General" }));
  expect(screen.getByLabelText("Name")).toHaveValue("Local draft");
  vi.mocked(getInventoryConfiguration).mockResolvedValueOnce({
    inventory: {
      ...inventory,
      name: "Remote name",
      configuration_revision: 12,
    },
    fields: [type],
  });
  await user.click(
    screen.getByRole("button", { name: "Discard draft and reload" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Name")).toHaveValue("Remote name"),
  );
  await user.click(screen.getByRole("button", { name: "Fields" }));
  expect(screen.getByText("Type")).toBeInTheDocument();
  expect(screen.queryByText("Local field")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(saveInventoryConfiguration).toHaveBeenLastCalledWith(
    inventory.id,
    expect.objectContaining({ expected_revision: 12, fields: [], options: [] }),
  );
});

// Test deletion in another window cannot erase the still-open editor's draft.
test("preserves a deleted inventory draft when its current configuration cannot be reloaded", async () => {
  const user = userEvent.setup();
  vi.mocked(saveInventoryConfiguration).mockRejectedValueOnce(
    new ApiError(404, "Deleted", "inventory_not_found"),
  );
  const { close } = renderEditor();
  const name = await screen.findByLabelText("Name");
  await user.type(name, " local");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  const reload = await screen.findByRole("button", {
    name: "Discard draft and reload",
  });
  vi.mocked(getInventoryConfiguration).mockRejectedValueOnce(
    new ApiError(404, "Deleted", "inventory_not_found"),
  );
  await user.click(reload);
  await screen.findByText(
    "The current configuration could not be loaded. Your draft is preserved.",
  );
  expect(name).toHaveValue("Games local");
  expect(close).not.toHaveBeenCalled();
  expect(saveInventoryConfiguration).toHaveBeenCalledOnce();
});

// Test unfinished child forms cannot be silently discarded by the conflict reload action.
test("blocks conflict reload while a field form is unfinished", async () => {
  const user = userEvent.setup();
  vi.mocked(saveInventoryConfiguration).mockRejectedValueOnce(
    new ApiError(409, "Stale", "inventory_configuration_conflict"),
  );
  renderEditor("fields");
  await user.click(await screen.findByRole("button", { name: "Save changes" }));
  await screen.findByRole("button", { name: "Discard draft and reload" });
  await user.click(screen.getByRole("button", { name: "New field" }));
  expect(
    screen.getByRole("button", { name: "Discard draft and reload" }),
  ).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(
    screen.getByRole("button", { name: "Discard draft and reload" }),
  ).toBeEnabled();
  expect(getInventoryConfiguration).toHaveBeenCalledOnce();
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
