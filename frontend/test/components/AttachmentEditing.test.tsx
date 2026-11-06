import { seedView } from "../helpers/preferences";
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
import { InventoryItemCreateForm } from "../../src/components/InventoryItemCreateForm";
import { InventoryItemList } from "../../src/components/InventoryItemList";
import { useInventoryItems } from "../../src/hooks/useInventoryItems";
import * as api from "../../src/services/inventoryItems";
import { getInventoryConfiguration } from "../../src/services/inventoryEditor";
import {
  uploadAttachment,
  discardAttachment,
} from "../../src/services/attachments";
import { ApiError } from "../../src/services/api";
import type {
  InventoryItem,
  InventoryItemInput,
} from "../../src/types/inventoryItem";
import {
  attachment,
  attachmentField,
  titleField,
  savedItem,
  savedAttachment,
} from "../helpers/attachments";

vi.mock("../../src/services/inventoryItems", () => ({
  getInventoryItems: vi.fn(),
  createInventoryItem: vi.fn(),
  updateInventoryItem: vi.fn(),
  updateInventoryItems: vi.fn(),
  deleteInventoryItem: vi.fn(),
}));
vi.mock("../../src/services/inventoryEditor", () => ({
  getInventoryConfiguration: vi.fn(),
}));
vi.mock("../../src/services/attachments", async (original) => ({
  ...(await original<object>()),
  uploadAttachment: vi.fn(),
  discardAttachment: vi.fn(),
}));
const fields = [titleField, attachmentField];
let rows: InventoryItem[];

/**
 * Simulate a successful backend replacement with authoritative saved attachment metadata.
 * @param id The existing or new item identity.
 * @param data The complete replacement payload.
 * @returns A newly revisioned item, as returned by the real backend.
 */
function persist(id: string, data: InventoryItemInput): InventoryItem {
  const previous = rows.find((row) => row.id === id) ?? { ...savedItem, id };
  const ids = data.values.find(
    (value) => value.field_id === attachmentField.id,
  )?.value;
  const result = {
    ...previous,
    revision: previous.revision + 1,
    values: data.values.map((value, index) => ({
      id: `value-${index}`,
      ...value,
      created_at: "",
      updated_at: "",
    })),
    attachments: Array.isArray(ids)
      ? ids.map((fileId) => attachment(fileId, { item_id: id }))
      : [],
  };
  rows = [...rows.filter((row) => row.id !== id), result];
  return result;
}

beforeEach(() => {
  rows = [structuredClone(savedItem)];
  vi.mocked(api.getInventoryItems).mockImplementation(async () => rows);
  vi.mocked(api.createInventoryItem).mockImplementation(async (_, data) =>
    persist("new-item", data),
  );
  vi.mocked(api.updateInventoryItem).mockImplementation(async (_, id, data) =>
    persist(id, data),
  );
  vi.mocked(api.updateInventoryItems).mockImplementation(async (_, input) =>
    input.items.map((row) => persist(row.item_id, row)),
  );
  vi.mocked(getInventoryConfiguration).mockResolvedValue({
    inventory: {
      id: "inventory",
      name: "Collection",
      description: null,
      configuration_revision: 6,
      created_at: "",
      updated_at: "",
    },
    fields,
  });
  vi.mocked(uploadAttachment).mockResolvedValue(attachment("uploaded"));
  vi.mocked(discardAttachment).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/**
 * Mount either creation or the live query-backed table with ordinary mutation hooks.
 * @param creation Whether to render the new-item control rather than the table.
 * @returns The isolated cache for background-update tests.
 */
function show(creation = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Table() {
    const query = useInventoryItems("inventory");
    return (
      <InventoryItemList
        inventoryId="inventory"
        fields={fields}
        items={query.data ?? []}
      />
    );
  }
  render(
    <QueryClientProvider client={client}>
      {creation ? (
        <InventoryItemCreateForm inventoryId="inventory" fields={fields} />
      ) : (
        <Table />
      )}
    </QueryClientProvider>,
  );
  return client;
}

// Uploads remain stages until the ordinary parent save, which sends only opaque IDs and keeps saved bytes.
test("creates an item with multiple uploaded files in one save", async () => {
  const user = userEvent.setup();
  show(true);
  vi.mocked(uploadAttachment)
    .mockResolvedValueOnce(attachment("first"))
    .mockResolvedValueOnce(attachment("second"));
  await user.click(screen.getByRole("button", { name: "New item" }));
  await user.upload(screen.getByLabelText("Files"), [
    new File(["one"], "one.txt"),
    new File(["two"], "two.txt"),
  ]);
  await screen.findByRole("link", { name: "second.txt" });
  expect(api.createInventoryItem).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Add item" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(api.createInventoryItem).toHaveBeenCalledExactlyOnceWith("inventory", {
    values: [{ field_id: "files", value: ["first", "second"] }],
  });
  expect(discardAttachment).not.toHaveBeenCalled();
});

// Cancel may close immediately while streaming; a late response cleans itself without adding into a new draft.
test("cancels a pending upload and safely discards its late result", async () => {
  const user = userEvent.setup();
  let finish!: (file: ReturnType<typeof attachment>) => void;
  vi.mocked(uploadAttachment).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show(true);
  await user.click(screen.getByRole("button", { name: "New item" }));
  await user.upload(
    screen.getByLabelText("Files"),
    new File(["data"], "late.txt"),
  );
  expect(screen.getByRole("button", { name: "Add item" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "New item" }));
  await act(async () => finish(attachment("late")));
  await waitFor(() =>
    expect(discardAttachment).toHaveBeenCalledWith(attachment("late")),
  );
  expect(
    screen.queryByRole("link", { name: "late.txt" }),
  ).not.toBeInTheDocument();
  expect(api.createInventoryItem).not.toHaveBeenCalled();
});

// Local removal of saved files is reversible by cancel and never uses the staged DELETE endpoint.
test("cancels item editing without removing saved attachments", async () => {
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  const dialog = screen.getByRole("dialog", { name: "Edit inventory item" });
  await user.click(
    within(dialog).getByRole("button", { name: "Remove saved.txt" }),
  );
  expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(api.updateInventoryItem).not.toHaveBeenCalled();
  expect(discardAttachment).not.toHaveBeenCalled();
  expect(screen.getByRole("link", { name: "saved.txt" })).toBeInTheDocument();
});

// Conflict failures retain uploaded stages and original revisions until the user discards the session.
test("retains uploaded filenames after a failed item save and discards only stages on cancel", async () => {
  const user = userEvent.setup();
  vi.mocked(api.updateInventoryItem).mockRejectedValueOnce(
    new ApiError(409, "Changed", "inventory_item_conflict"),
  );
  const client = show();
  await user.click(await screen.findByRole("button", { name: "Edit" }));
  const dialog = screen.getByRole("dialog", { name: "Edit inventory item" });
  await user.upload(
    within(dialog).getByLabelText("Files"),
    new File(["data"], "upload.txt"),
  );
  await within(dialog).findByRole("link", { name: "uploaded.txt" });
  act(() => {
    client.setQueryData(
      ["inventories", "inventory", "items"],
      [{ ...savedItem, revision: 10, attachments: [] }],
    );
  });
  await user.click(
    within(dialog).getByRole("button", { name: "Save changes" }),
  );
  await within(dialog).findByRole("alert");
  expect(api.updateInventoryItem).toHaveBeenLastCalledWith(
    "inventory",
    "item",
    expect.objectContaining({
      expected_revision: 4,
      values: expect.arrayContaining([
        { field_id: "files", value: [savedAttachment.id, "uploaded"] },
      ]),
    }),
  );
  expect(
    within(dialog).getByRole("link", { name: "uploaded.txt" }),
  ).toBeInTheDocument();
  expect(discardAttachment).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(discardAttachment).toHaveBeenCalledExactlyOnceWith(
      attachment("uploaded"),
    ),
  );
});

// Full replacements retain untouched hidden file arrays rather than turning them into comma-separated text.
test("preserves hidden attachment IDs while editing another table cell", async () => {
  const user = userEvent.setup();
  await seedView("inventory", {
    version: 1,
    hiddenFieldIds: ["files"],
    sort: null,
    wrapText: false,
    columnWidths: {},
  });
  show();
  await user.click(await screen.findByRole("button", { name: "Edit table" }));
  const title = await screen.findByRole("textbox", { name: "Title" });
  await user.clear(title);
  await user.type(title, "Changed");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(api.updateInventoryItems).toHaveBeenCalledOnce());
  expect(api.updateInventoryItems).toHaveBeenCalledWith("inventory", {
    expected_configuration_revision: 6,
    items: [
      {
        item_id: "item",
        expected_revision: 4,
        values: [
          { field_id: "title", value: "Changed" },
          { field_id: "files", value: ["saved"] },
        ],
      },
    ],
  });
  expect(discardAttachment).not.toHaveBeenCalled();
});

// Newly uploaded files in different rows travel through one atomic table request, preserving row ownership.
test("saves new files in two rows through one atomic table replacement", async () => {
  const user = userEvent.setup();
  rows.push({
    ...savedItem,
    id: "other",
    values: [{ ...savedItem.values[0], value: "Other" }],
    attachments: [],
  });
  vi.mocked(uploadAttachment)
    .mockResolvedValueOnce(attachment("first"))
    .mockResolvedValueOnce(attachment("second"));
  show();
  await user.click(await screen.findByRole("button", { name: "Edit table" }));
  const titles = await screen.findAllByRole("textbox", { name: "Title" });
  await user.upload(
    within(titles[0]!.closest("tr")!).getByLabelText("Files"),
    new File(["first"], "first.txt"),
  );
  await within(titles[0]!.closest("tr")!).findByRole("link", {
    name: "first.txt",
  });
  await user.upload(
    within(titles[1]!.closest("tr")!).getByLabelText("Files"),
    new File(["second"], "second.txt"),
  );
  await within(titles[1]!.closest("tr")!).findByRole("link", {
    name: "second.txt",
  });
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(api.updateInventoryItems).toHaveBeenCalledOnce());
  expect(api.updateInventoryItems).toHaveBeenCalledWith("inventory", {
    expected_configuration_revision: 6,
    items: [
      {
        item_id: "item",
        expected_revision: 4,
        values: [
          { field_id: "title", value: "Original" },
          { field_id: "files", value: ["saved", "first"] },
        ],
      },
      {
        item_id: "other",
        expected_revision: 4,
        values: [
          { field_id: "title", value: "Other" },
          { field_id: "files", value: ["second"] },
        ],
      },
    ],
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: "Title" }),
    ).not.toBeInTheDocument(),
  );
  expect(discardAttachment).not.toHaveBeenCalled();
});

// A failed atomic save retains the staged names, and explicit cancel cleans only those stages.
test("keeps file uploads in a conflicting table draft until it is explicitly canceled", async () => {
  const user = userEvent.setup();
  vi.mocked(api.updateInventoryItems).mockRejectedValueOnce(
    new ApiError(409, "Changed", "inventory_item_conflict"),
  );
  show();
  await user.click(await screen.findByRole("button", { name: "Edit table" }));
  const title = await screen.findByRole("textbox", { name: "Title" });
  await user.upload(
    within(title.closest("tr")!).getByLabelText("Files"),
    new File(["data"], "new.txt"),
  );
  await within(title.closest("tr")!).findByRole("link", {
    name: "uploaded.txt",
  });
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert");
  expect(
    screen.getByRole("link", { name: "uploaded.txt" }),
  ).toBeInTheDocument();
  expect(discardAttachment).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(discardAttachment).toHaveBeenCalledExactlyOnceWith(
      attachment("uploaded"),
    ),
  );
  expect(screen.getByRole("link", { name: "saved.txt" })).toBeInTheDocument();
});

// Route/page unmount also invalidates the upload's generation, not just the visible Cancel action.
test("cleans a staged upload that finishes after its parent form unmounts", async () => {
  const user = userEvent.setup();
  let finish!: (file: ReturnType<typeof attachment>) => void;
  vi.mocked(uploadAttachment).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  show(true);
  await user.click(screen.getByRole("button", { name: "New item" }));
  await user.upload(
    screen.getByLabelText("Files"),
    new File(["data"], "late.txt"),
  );
  cleanup();
  await act(async () => finish(attachment("late")));
  await waitFor(() =>
    expect(discardAttachment).toHaveBeenCalledExactlyOnceWith(
      attachment("late"),
    ),
  );
  expect(api.createInventoryItem).not.toHaveBeenCalled();
});

// The real table wires View to the persisted preference and keeps thumbnail loading opt-in.
test("toggles image previews from View and restores the choice when the inventory remounts", async () => {
  const user = userEvent.setup();

  rows[0]!.attachments = [
    { ...savedAttachment, filename: "photo.png", media_type: "image/png" },
  ];
  show();
  await screen.findByRole("link", { name: "photo.png" });
  expect(document.querySelector("img")).toBeNull();
  await user.click(screen.getByRole("button", { name: "View" }));
  await user.click(
    screen.getByRole("menuitemcheckbox", { name: "Image previews" }),
  );
  expect(document.querySelector("img")).toHaveAttribute(
    "src",
    expect.stringContaining("/preview"),
  );
  cleanup();
  show();
  await screen.findByRole("link", { name: "photo.png" });
  expect(document.querySelector("img")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "View" }));
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Image previews" }),
  ).toHaveAttribute("aria-checked", "true");
  await user.click(
    screen.getByRole("menuitemcheckbox", { name: "Image previews" }),
  );
  expect(document.querySelector("img")).toBeNull();
});
