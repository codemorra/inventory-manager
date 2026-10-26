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
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import { ApiError } from "../../src/services/api";
import { createInventory } from "../../src/services/inventories";
import { InventoryCreateForm } from "../../src/components/InventoryCreateForm";
import {
  getInventoryTemplates,
  instantiateInventoryTemplate,
} from "../../src/services/inventoryTemplates";
import { getInventoryGroups } from "../../src/services/inventoryGroups";
import type { InventoryTemplate } from "../../src/types/inventoryTemplate";

vi.mock("../../src/services/inventoryTemplates", () => ({
  getInventoryTemplates: vi.fn(),
  instantiateInventoryTemplate: vi.fn(),
}));
vi.mock("../../src/services/inventoryGroups", () => ({
  getInventoryGroups: vi.fn(),
}));

const template: InventoryTemplate = {
  id: "template",
  name: "Cable structure",
  description: "Reusable columns",
  revision: 3,
  fields: [
    {
      name: "Cable",
      field_type: "text",
      max_length: 80,
      is_required: false,
      is_sortable: true,
      reuse_deleted_ids: false,
      options: [],
    },
  ],
  created_at: "",
  updated_at: "",
};
const created = {
  id: "copy",
  name: "New cables",
  description: null,
  configuration_revision: 2,
  created_at: "",
  updated_at: "",
};

beforeEach(() => {
  vi.mocked(getInventoryTemplates).mockReset().mockResolvedValue([]);
  vi.mocked(getInventoryGroups).mockReset().mockResolvedValue([]);
  vi.mocked(instantiateInventoryTemplate).mockReset();
});

vi.mock("../../src/services/inventories", () => ({
  createInventory: vi.fn(),
  getInventories: vi.fn(),
}));

const mockedCreateInventory = vi.mocked(createInventory);

// Expose the destination URL without replacing the form under test.
function Location() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

/** Render the creation form with an isolated query client. */
function renderInventoryCreateForm() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/inventories/existing/items"]}>
        <InventoryCreateForm />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Choose an option through the application's themed dropdown.
 * @param user The current interaction session.
 * @param label The accessible dropdown label.
 * @param option The visible option name.
 */
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(screen.getByRole("option", { name: option }));
}

// Creation dependencies are loaded only after the dialog is opened.
test("does not load templates or groups for a closed creation dialog", () => {
  renderInventoryCreateForm();
  expect(getInventoryTemplates).not.toHaveBeenCalled();
  expect(getInventoryGroups).not.toHaveBeenCalled();
});

// A single template request carries captured revision and new metadata, then seeds its configuration.
test("creates from a selected template in a chosen group without copying template metadata", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryTemplates).mockResolvedValue([template]);
  vi.mocked(getInventoryGroups).mockResolvedValue([
    { id: "group", name: "Office", created_at: "", updated_at: "" },
  ]);
  const result = { inventory: { ...created, group_id: "group" }, fields: [] };
  vi.mocked(instantiateInventoryTemplate).mockResolvedValue(result);
  const { queryClient } = renderInventoryCreateForm();
  await user.click(screen.getByRole("button", { name: "New inventory" }));
  await choose(user, "Template", template.name);
  expect(screen.getByText("Reusable columns")).toBeInTheDocument();
  const fields = screen.getByRole("list", { name: "1 field:" });
  expect(within(fields).getByText("Cable")).toBeInTheDocument();
  expect(within(fields).getByText("(Text)")).toBeInTheDocument();
  expect(screen.getByLabelText("Name")).toHaveValue("");
  expect(screen.getByLabelText("Description")).toHaveValue("");
  await user.type(screen.getByLabelText("Name"), "  New cables  ");
  await user.type(screen.getByLabelText("Description"), "  Own notes  ");
  await choose(user, "Group", "Office");
  await user.click(screen.getByRole("button", { name: "Create inventory" }));
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventories/copy/items",
    ),
  );
  expect(instantiateInventoryTemplate).toHaveBeenCalledExactlyOnceWith(
    "template",
    {
      name: "New cables",
      description: "Own notes",
      group_id: "group",
      expected_revision: 3,
    },
  );
  expect(createInventory).not.toHaveBeenCalled();
  expect(
    queryClient.getQueryData(["inventories", "copy", "configuration"]),
  ).toEqual(result);
  expect(queryClient.getQueryData(["inventories", "copy", "items"])).toEqual(
    [],
  );
});

// Background refresh cannot silently substitute the revision originally chosen by the user.
test("retains a stale selection and inputs until its revision is explicitly reloaded", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryTemplates).mockResolvedValue([template]);
  vi.mocked(instantiateInventoryTemplate)
    .mockRejectedValueOnce(
      new ApiError(409, "Changed", "inventory_template_conflict"),
    )
    .mockResolvedValue({ inventory: created, fields: [] });
  const { queryClient } = renderInventoryCreateForm();
  await user.click(screen.getByRole("button", { name: "New inventory" }));
  await choose(user, "Template", template.name);
  await user.type(screen.getByLabelText("Name"), "New cables");
  await user.type(screen.getByLabelText("Description"), "Keep my notes");
  const latest = { ...template, revision: 8, name: "Changed template" };
  act(() => {
    queryClient.setQueryData(["inventory-templates"], [latest]);
  });
  await user.click(screen.getByRole("button", { name: "Create inventory" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "selected template has changed",
  );
  expect(instantiateInventoryTemplate).toHaveBeenLastCalledWith(
    "template",
    expect.objectContaining({ expected_revision: 3 }),
  );
  expect(screen.getByLabelText("Name")).toHaveValue("New cables");
  expect(screen.getByLabelText("Description")).toHaveValue("Keep my notes");
  expect(
    screen.getByRole("button", { name: "Create inventory" }),
  ).toBeDisabled();
  expect(instantiateInventoryTemplate).toHaveBeenCalledOnce();
  vi.mocked(getInventoryTemplates).mockResolvedValue([latest]);
  await user.click(
    screen.getByRole("button", { name: "Reload selected template" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Create inventory" }),
    ).toBeEnabled(),
  );
  await user.click(screen.getByRole("button", { name: "Create inventory" }));
  await waitFor(() =>
    expect(instantiateInventoryTemplate).toHaveBeenLastCalledWith("template", {
      expected_revision: 8,
      name: "New cables",
      description: "Keep my notes",
    }),
  );
});

// Deletion and failed reloads must never turn a template request into an empty-inventory request.
test("keeps missing templates blocked after reload and allows explicitly choosing empty creation", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryTemplates).mockResolvedValue([template]);
  vi.mocked(instantiateInventoryTemplate).mockRejectedValue(
    new ApiError(404, "Deleted", "inventory_template_not_found"),
  );
  mockedCreateInventory.mockResolvedValue(created);
  renderInventoryCreateForm();
  await user.click(screen.getByRole("button", { name: "New inventory" }));
  await choose(user, "Template", template.name);
  await user.type(screen.getByLabelText("Name"), "New cables");
  await user.click(screen.getByRole("button", { name: "Create inventory" }));
  await screen.findByRole("alert");
  vi.mocked(getInventoryTemplates).mockRejectedValueOnce(new Error("Offline"));
  await user.click(
    screen.getByRole("button", { name: "Reload selected template" }),
  );
  await screen.findByText(/Templates could not be loaded/);
  expect(
    screen.getByRole("button", { name: "Create inventory" }),
  ).toBeDisabled();
  vi.mocked(getInventoryTemplates).mockResolvedValue([]);
  await user.click(
    screen.getByRole("button", { name: "Reload selected template" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByText(/Templates could not be loaded/),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("button", { name: "Create inventory" }),
  ).toBeDisabled();
  expect(createInventory).not.toHaveBeenCalled();
  await choose(user, "Template", "Empty inventory");
  await user.click(screen.getByRole("button", { name: "Create inventory" }));
  await waitFor(() =>
    expect(createInventory).toHaveBeenCalledWith({
      name: "New cables",
      description: null,
    }),
  );
});

// Pending writes lock all inputs, reject duplicate submit events, and survive Escape/dismissal.
test("keeps a pending template request mounted and sends it only once", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryTemplates).mockResolvedValue([template]);
  let finish!: (value: { inventory: typeof created; fields: [] }) => void;
  vi.mocked(instantiateInventoryTemplate).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  renderInventoryCreateForm();
  await user.click(screen.getByRole("button", { name: "New inventory" }));
  await choose(user, "Template", template.name);
  await user.type(screen.getByLabelText("Name"), "New cables");
  const form = screen.getByLabelText("Name").closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() =>
    expect(instantiateInventoryTemplate).toHaveBeenCalledOnce(),
  );
  expect(screen.getByLabelText("Name")).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "Template" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => finish({ inventory: created, fields: [] }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

// Optional template loading failure does not prevent the existing empty-inventory flow.
test("allows empty creation after template loading fails", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryTemplates).mockRejectedValue(new Error("Offline"));
  mockedCreateInventory.mockResolvedValue(created);
  renderInventoryCreateForm();
  await user.click(screen.getByRole("button", { name: "New inventory" }));
  await screen.findByText(/Templates could not be loaded/);
  await user.type(screen.getByLabelText("Name"), "Empty");
  await user.click(screen.getByRole("button", { name: "Create inventory" }));
  await waitFor(() =>
    expect(createInventory).toHaveBeenCalledWith({
      name: "Empty",
      description: null,
    }),
  );
});

describe("InventoryCreateForm", () => {
  // Test suite for the InventoryCreateForm component
  test("submits the entered inventory data", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockResolvedValue({
      configuration_revision: 1,
      id: "inventory-1",
      name: "Cables",
      description: "Cable collection",
      created_at: "2026-09-14T10:00:00Z",
      updated_at: "2026-09-14T10:00:00Z",
    });

    renderInventoryCreateForm();

    await user.click(screen.getByRole("button", { name: "New inventory" }));

    await user.type(screen.getByLabelText("Name"), "Cables");
    await user.type(
      screen.getByLabelText("Description"),
      "  Cable collection  ",
    );
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    await waitFor(() => {
      expect(mockedCreateInventory).toHaveBeenCalledWith({
        name: "Cables",
        description: "Cable collection",
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/inventories/inventory-1/items",
      ),
    );
  });

  // Test that the form clears its fields after a successful submission
  test("clears fields after a successful submission", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockResolvedValue({
      configuration_revision: 1,
      id: "inventory-1",
      name: "Cables",
      description: null,
      created_at: "2026-09-14T10:00:00Z",
      updated_at: "2026-09-14T10:00:00Z",
    });

    renderInventoryCreateForm();

    await user.click(screen.getByRole("button", { name: "New inventory" }));

    const nameInput = screen.getByLabelText("Name");
    const descriptionInput = screen.getByLabelText("Description");

    await user.type(nameInput, "Cables");
    await user.type(descriptionInput, "Cable collection");
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "New inventory" }));

    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  // Test that an API error message is displayed after a failed submission
  test("displays an API error message after a failed submission", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockRejectedValue(
      new ApiError(500, "Unable to reach the backend."),
    );

    renderInventoryCreateForm();

    await user.click(screen.getByRole("button", { name: "New inventory" }));

    await user.type(screen.getByLabelText("Name"), "Cables");
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventories/existing/items",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Cables");
  });

  // Test that the submission button is disabled while the request is pending
  test("disables submission while the request is pending", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockImplementation(
      () => new Promise<never>(() => {}),
    );

    renderInventoryCreateForm();

    await user.click(screen.getByRole("button", { name: "New inventory" }));

    await user.type(screen.getByLabelText("Name"), "Cables");
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventories/existing/items",
    );
  });
});

// Ordinary storage errors preserve selection and metadata and allow retrying the same revision.
test("keeps template creation inputs after an ordinary error without retrying automatically", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryTemplates).mockResolvedValue([template]);
  vi.mocked(instantiateInventoryTemplate)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue({ inventory: created, fields: [] });
  renderInventoryCreateForm();
  await user.click(screen.getByRole("button", { name: "New inventory" }));
  await choose(user, "Template", template.name);
  await user.type(screen.getByLabelText("Name"), "New cables");
  await user.type(screen.getByLabelText("Description"), "Keep notes");
  await user.click(screen.getByRole("button", { name: "Create inventory" }));
  await screen.findByRole("alert");
  expect(instantiateInventoryTemplate).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Name")).toHaveValue("New cables");
  expect(screen.getByLabelText("Description")).toHaveValue("Keep notes");
  expect(screen.getByRole("combobox", { name: "Template" })).toHaveTextContent(
    template.name,
  );
  expect(
    screen.getByRole("button", { name: "Create inventory" }),
  ).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Create inventory" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(instantiateInventoryTemplate).toHaveBeenCalledTimes(2);
  expect(instantiateInventoryTemplate).toHaveBeenLastCalledWith(template.id, {
    name: "New cables",
    description: "Keep notes",
    expected_revision: 3,
  });
});

// Toggle buttons expose selection without relying on color and submit only included positions.
test("starts with every field selected, toggles individual fields, and submits only included fields", async () => {
  const user = userEvent.setup();
  const blueprint = {
    ...template,
    fields: [
      ...template.fields,
      {
        ...template.fields[0]!,
        name: "Quantity",
        field_type: "number" as const,
        max_length: null,
      },
    ],
  };
  vi.mocked(getInventoryTemplates).mockResolvedValue([blueprint]);
  vi.mocked(instantiateInventoryTemplate).mockResolvedValue({
    inventory: created,
    fields: [],
  });
  renderInventoryCreateForm();
  await user.click(screen.getByRole("button", { name: "New inventory" }));
  await choose(user, "Template", blueprint.name);
  const cable = screen.getByRole("button", { name: "Cable (Text)" });
  const quantity = screen.getByRole("button", { name: "Quantity (Number)" });
  expect(cable).toHaveAttribute("aria-pressed", "true");
  expect(quantity).toHaveAttribute("aria-pressed", "true");
  await user.click(quantity);
  expect(quantity).toHaveAttribute("aria-pressed", "false");
  await user.keyboard(" ");
  expect(quantity).toHaveAttribute("aria-pressed", "true");
  await user.click(cable);
  await user.type(screen.getByLabelText("Name"), "Selected fields");
  await user.click(screen.getByRole("button", { name: "Create inventory" }));
  await waitFor(() =>
    expect(instantiateInventoryTemplate).toHaveBeenCalledExactlyOnceWith(
      template.id,
      {
        name: "Selected fields",
        description: null,
        expected_revision: 3,
        field_indexes: [1],
      },
    ),
  );
  expect(blueprint.fields).toHaveLength(2);
});

// Switching or explicitly reloading a template starts a new all-selected field baseline.
test("resets field choices on template load and allows omitting every field", async () => {
  const user = userEvent.setup();
  vi.mocked(getInventoryTemplates).mockResolvedValue([template]);
  vi.mocked(instantiateInventoryTemplate)
    .mockRejectedValueOnce(
      new ApiError(409, "Changed", "inventory_template_conflict"),
    )
    .mockResolvedValue({ inventory: created, fields: [] });
  renderInventoryCreateForm();
  await user.click(screen.getByRole("button", { name: "New inventory" }));
  await choose(user, "Template", template.name);
  await user.click(screen.getByRole("button", { name: "Cable (Text)" }));
  await choose(user, "Template", "Empty inventory");
  await choose(user, "Template", template.name);
  expect(screen.getByRole("button", { name: "Cable (Text)" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "Cable (Text)" }));
  await user.type(screen.getByLabelText("Name"), "Empty structure");
  await user.click(screen.getByRole("button", { name: "Create inventory" }));
  await screen.findByRole("alert");
  expect(instantiateInventoryTemplate).toHaveBeenLastCalledWith(
    template.id,
    expect.objectContaining({ field_indexes: [], expected_revision: 3 }),
  );
  expect(screen.getByRole("button", { name: "Cable (Text)" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  vi.mocked(getInventoryTemplates).mockResolvedValue([
    { ...template, revision: 8 },
  ]);
  await user.click(
    screen.getByRole("button", { name: "Reload selected template" }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Cable (Text)" }),
    ).toHaveAttribute("aria-pressed", "true"),
  );
  await user.click(screen.getByRole("button", { name: "Create inventory" }));
  await waitFor(() =>
    expect(instantiateInventoryTemplate).toHaveBeenLastCalledWith(template.id, {
      name: "Empty structure",
      description: null,
      expected_revision: 8,
    }),
  );
});
