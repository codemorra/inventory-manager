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
import { TemplatesSettings } from "../../src/components/TemplatesSettings";
import * as api from "../../src/services/inventoryTemplates";
import { ApiError } from "../../src/services/api";
import type { InventoryTemplate } from "../../src/types/inventoryTemplate";
import { dragField } from "../helpers/fieldDrag";

vi.mock("../../src/services/inventoryTemplates", () => ({
  getInventoryTemplates: vi.fn(),
  getInventoryTemplate: vi.fn(),
  updateInventoryTemplate: vi.fn(),
  deleteInventoryTemplate: vi.fn(),
}));

const original: InventoryTemplate = {
  id: "template",
  name: "Cable structure",
  description: "Saved notes",
  revision: 3,
  fields: [
    {
      name: "Title",
      field_type: "text",
      max_length: 80,
      is_required: false,
      is_sortable: true,
      reuse_deleted_ids: false,
      options: [],
    },
    {
      name: "Type",
      field_type: "select",
      max_length: null,
      is_required: true,
      is_sortable: false,
      reuse_deleted_ids: false,
      options: [{ name: "USB" }, { name: "HDMI" }],
    },
  ],
  created_at: "",
  updated_at: "",
};
let saved: InventoryTemplate;
let deleted: boolean;
beforeEach(() => {
  saved = structuredClone(original);
  deleted = false;
  vi.mocked(api.getInventoryTemplates).mockImplementation(async () =>
    deleted ? [] : [saved],
  );
  vi.mocked(api.getInventoryTemplate).mockImplementation(async () => saved);
  vi.mocked(api.updateInventoryTemplate).mockImplementation(async (_, data) => {
    saved = { ...saved, ...data, revision: saved.revision + 1 };
    return saved;
  });
  vi.mocked(api.deleteInventoryTemplate).mockImplementation(async () => {
    deleted = true;
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/**
 * Render management with an isolated cache and no inventory service dependencies.
 * @returns The live template query cache.
 */
function showPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <TemplatesSettings />
    </QueryClientProvider>,
  );
  return client;
}

/**
 * Open the selected template through its list action and await the complete detail snapshot.
 * @param user The interaction session.
 */
async function edit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", {
      name: "Edit template Cable structure",
    }),
  );
  await screen.findByRole("textbox", { name: "Name" });
}

// Management remains usable after an initial failed request and explains how to create the first template.
test("handles loading, retry, and empty management states", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getInventoryTemplates)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue([]);
  showPage();
  expect(screen.getByRole("status")).toHaveTextContent("Loading templates");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Templates could not be loaded",
  );
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByRole("heading", { name: "No templates yet." }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Save an inventory structure/)).toBeInTheDocument();
});

// A single explicit save persists metadata, field edits, options, new definitions, and drag order together.
test("saves the complete template draft once without leaking temporary field or option IDs", async () => {
  const user = userEvent.setup();
  const client = showPage();
  await edit(user);
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "  New structure  ");
  await user.clear(screen.getByLabelText("Description"));
  await user.type(screen.getByLabelText("Description"), "Own notes");
  await user.click(screen.getByRole("button", { name: "Fields" }));
  const fields = screen.getByRole("list", { name: "Fields" });
  await user.click(
    within(within(fields).getAllByRole("listitem")[1]!).getByRole("button", {
      name: "Edit",
    }),
  );
  const child = screen.getByRole("dialog", { name: "Edit inventory field" });
  await user.type(
    within(child).getByLabelText("New option name"),
    "DisplayPort",
  );
  await user.click(within(child).getByRole("button", { name: "Add" }));
  await user.click(within(child).getByRole("button", { name: "Save" }));
  await user.click(screen.getByRole("button", { name: "New field" }));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await user.type(screen.getByLabelText("Field name"), "Notes");
  await user.click(screen.getByRole("button", { name: "Add field" }));
  const rows = within(fields).getAllByRole("listitem");
  dragField(rows[2]!, rows[0]!, "before");
  expect(api.updateInventoryTemplate).not.toHaveBeenCalled();
  expect(client.getQueryData(["inventory-templates"])).toEqual([original]);
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(api.updateInventoryTemplate).toHaveBeenCalledExactlyOnceWith(
    "template",
    {
      expected_revision: 3,
      name: "New structure",
      description: "Own notes",
      fields: [
        {
          name: "Notes",
          field_type: "text",
          max_length: 255,
          is_required: false,
          is_sortable: true,
          reuse_deleted_ids: false,
          options: [],
        },
        original.fields[0],
        {
          ...original.fields[1],
          options: [{ name: "USB" }, { name: "HDMI" }, { name: "DisplayPort" }],
        },
      ],
    },
  );
  expect(
    await screen.findByRole("heading", { name: "New structure" }),
  ).toBeInTheDocument();
});

// Canceling a mixed metadata/field draft leaves the saved list and backend unchanged.
test("discards field removals and metadata edits on cancel", async () => {
  const user = userEvent.setup();
  const client = showPage();
  await edit(user);
  await user.type(screen.getByLabelText("Name"), " local");
  await user.click(screen.getByRole("button", { name: "Fields" }));
  const fields = screen.getByRole("list", { name: "Fields" });
  await user.click(
    within(within(fields).getAllByRole("listitem")[0]!).getByRole("button", {
      name: "Delete",
    }),
  );
  await user.click(
    within(
      screen.getByRole("dialog", { name: "Delete inventory field" }),
    ).getByRole("button", { name: "Delete" }),
  );
  expect(
    within(fields).queryByRole("heading", { name: "Title" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(api.updateInventoryTemplate).not.toHaveBeenCalled();
  expect(client.getQueryData(["inventory-templates"])).toEqual([original]);
  expect(
    screen.getByRole("button", { name: "Edit template Cable structure" }),
  ).toHaveFocus();
});

// Neither background data changes nor failed save/reload attempts may silently replace the captured draft.
test("retains local metadata and original revision through background updates and explicit conflict recovery", async () => {
  const user = userEvent.setup();
  vi.mocked(api.updateInventoryTemplate).mockRejectedValueOnce(
    new ApiError(409, "Changed", "inventory_template_conflict"),
  );
  const client = showPage();
  await edit(user);
  await user.type(screen.getByLabelText("Name"), " local");
  const latest = { ...original, name: "Remote", revision: 8, fields: [] };
  act(() => {
    client.setQueryData(["inventory-templates", "template"], latest);
    client.setQueryData(["inventory-templates"], []);
  });
  expect(screen.getByLabelText("Name")).toHaveValue("Cable structure local");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your draft has been kept",
  );
  expect(api.updateInventoryTemplate).toHaveBeenLastCalledWith(
    "template",
    expect.objectContaining({ expected_revision: 3 }),
  );
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  vi.mocked(api.getInventoryTemplate).mockRejectedValueOnce(
    new Error("Offline"),
  );
  await user.click(
    screen.getByRole("button", { name: "Discard draft and reload" }),
  );
  await screen.findByText(/current inputs have been kept/);
  expect(screen.getByLabelText("Name")).toHaveValue("Cable structure local");
  vi.mocked(api.getInventoryTemplate).mockResolvedValue(latest);
  await user.click(
    screen.getByRole("button", { name: "Discard draft and reload" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Name")).toHaveValue("Remote"),
  );
  await user.type(screen.getByLabelText("Name"), " saved");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(api.updateInventoryTemplate).toHaveBeenLastCalledWith(
      "template",
      expect.objectContaining({
        expected_revision: 8,
        name: "Remote saved",
        fields: [],
      }),
    ),
  );
});

// A pending mutation cannot be duplicated, canceled, or dismissed by Escape.
test("keeps a pending save mounted and rejects duplicate submit events", async () => {
  const user = userEvent.setup();
  let finish!: (value: InventoryTemplate) => void;
  vi.mocked(api.updateInventoryTemplate).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  showPage();
  await edit(user);
  const form = screen.getByLabelText("Name").closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() =>
    expect(api.updateInventoryTemplate).toHaveBeenCalledOnce(),
  );
  expect(screen.getByLabelText("Name")).toBeDisabled();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await act(async () => finish({ ...original, revision: 4 }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

// A stale list-row confirmation requires explicit reload and a separate second confirmation.
test("reloads a conflicting deletion target without automatically deleting its new revision", async () => {
  const user = userEvent.setup();
  vi.mocked(api.deleteInventoryTemplate).mockRejectedValueOnce(
    new ApiError(409, "Changed", "inventory_template_conflict"),
  );
  showPage();
  await user.click(
    await screen.findByRole("button", {
      name: "Delete template Cable structure",
    }),
  );
  expect(api.deleteInventoryTemplate).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "confirming deletion again",
  );
  expect(api.deleteInventoryTemplate).toHaveBeenCalledExactlyOnceWith(
    "template",
    3,
  );
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  saved = { ...original, name: "Remote", revision: 8 };
  await user.click(screen.getByRole("button", { name: "Reload template" }));
  await screen.findByText(/Delete “Remote”/);
  expect(api.deleteInventoryTemplate).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(api.deleteInventoryTemplate).toHaveBeenLastCalledWith("template", 8);
  expect(await screen.findByText("No templates yet.")).toBeInTheDocument();
});

// Missing detail snapshots do not open an empty editor, and retry can recover without writing anything.
test("handles missing detail reads and retries before opening a template draft", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getInventoryTemplate).mockRejectedValueOnce(
    new ApiError(404, "Deleted", "inventory_template_not_found"),
  );
  showPage();
  await user.click(
    await screen.findByRole("button", {
      name: "Edit template Cable structure",
    }),
  );
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("textbox", { name: "Name" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("textbox", { name: "Name" })).toHaveValue(
    original.name,
  );
  expect(api.updateInventoryTemplate).not.toHaveBeenCalled();
});

// Ordinary save failures preserve a usable draft and do not retry automatically.
test("preserves drafts after ordinary save errors and allows a manual retry", async () => {
  const user = userEvent.setup();
  vi.mocked(api.updateInventoryTemplate).mockRejectedValueOnce(
    new Error("Offline"),
  );
  showPage();
  await edit(user);
  await user.type(screen.getByLabelText("Description"), " local");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByRole("alert");
  expect(api.updateInventoryTemplate).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Description")).toHaveValue("Saved notes local");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(api.updateInventoryTemplate).toHaveBeenCalledTimes(2);
});

// Detail revision, rather than the older list row, is authoritative for a newly opened editor.
test("uses the fresh detail snapshot when the list row is already stale", async () => {
  const user = userEvent.setup();
  vi.mocked(api.getInventoryTemplate).mockResolvedValue({
    ...original,
    name: "Latest structure",
    revision: 9,
  });
  showPage();
  await edit(user);
  expect(screen.getByLabelText("Name")).toHaveValue("Latest structure");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(api.updateInventoryTemplate).toHaveBeenLastCalledWith(
      "template",
      expect.objectContaining({
        expected_revision: 9,
        name: "Latest structure",
      }),
    ),
  );
});

// A pending delete remains mounted and sends one request even under repeated confirm events.
test("prevents duplicate deletion and dismissal while its request is pending", async () => {
  const user = userEvent.setup();
  let finish!: () => void;
  vi.mocked(api.deleteInventoryTemplate).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  showPage();
  await user.click(
    await screen.findByRole("button", {
      name: "Delete template Cable structure",
    }),
  );
  const button = screen.getByRole("button", { name: "Delete" });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() =>
    expect(api.deleteInventoryTemplate).toHaveBeenCalledOnce(),
  );
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await act(async () => finish());
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

// A deleted target cannot be silently retried after failed explicit recovery.
test("retains a missing deletion target and allows canceling failed recovery", async () => {
  const user = userEvent.setup();
  vi.mocked(api.deleteInventoryTemplate).mockRejectedValue(
    new ApiError(404, "Gone", "inventory_template_not_found"),
  );
  showPage();
  await user.click(
    await screen.findByRole("button", {
      name: "Delete template Cable structure",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await screen.findByRole("alert");
  vi.mocked(api.getInventoryTemplate).mockRejectedValue(
    new ApiError(404, "Gone", "inventory_template_not_found"),
  );
  await user.click(screen.getByRole("button", { name: "Reload template" }));
  await screen.findByText(/current inputs have been kept/);
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  expect(api.deleteInventoryTemplate).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
