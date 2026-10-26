import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SaveInventoryTemplateDialog } from "../../src/components/SaveInventoryTemplateDialog";
import { saveInventoryTemplate } from "../../src/services/inventoryTemplates";
import { ApiError } from "../../src/services/api";
import i18n from "../../src/i18n";

vi.mock("../../src/services/inventoryTemplates", () => ({
  saveInventoryTemplate: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/**
 * Render a source snapshot with independently observed completion and conflict callbacks.
 * @returns The session callbacks and isolated query cache.
 */
function open() {
  const callbacks = { onClose: vi.fn(), onSaved: vi.fn(), onConflict: vi.fn() };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SaveInventoryTemplateDialog
        inventoryId="source"
        revision={7}
        {...callbacks}
      />
    </QueryClientProvider>,
  );
  return { ...callbacks, client };
}

// Failed saves retain inputs and can be retried without changing the captured source revision.
test("retains metadata after a failed save and retries the same source snapshot", async () => {
  const user = userEvent.setup();
  vi.mocked(saveInventoryTemplate)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue({
      id: "template",
      revision: 1,
      name: "New blueprint",
      description: null,
      fields: [],
      created_at: "",
      updated_at: "",
    });
  const callbacks = open();
  expect(screen.getByLabelText("Name")).toHaveValue("");
  expect(screen.getByLabelText("Description")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled();
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "  New blueprint  ");
  await user.clear(screen.getByLabelText("Description"));
  await user.click(screen.getByRole("button", { name: "Save template" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "inputs have been kept",
  );
  expect(screen.getByLabelText("Name")).toHaveValue("  New blueprint  ");
  expect(callbacks.onSaved).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Save template" }));
  await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce());
  expect(saveInventoryTemplate).toHaveBeenCalledTimes(2);
  expect(saveInventoryTemplate).toHaveBeenLastCalledWith({
    name: "New blueprint",
    description: null,
    source_inventory_id: "source",
    expected_configuration_revision: 7,
  });
});

// Source conflicts block stale retries while retaining the form for explicit cancellation.
test.each(["inventory_configuration_conflict", "inventory_not_found"])(
  "preserves inputs and reports %s to the parent editor",
  async (code) => {
    const user = userEvent.setup();
    vi.mocked(saveInventoryTemplate).mockRejectedValue(
      new ApiError(code.endsWith("not_found") ? 404 : 409, "Changed", code),
    );
    const callbacks = open();
    await user.type(screen.getByLabelText("Name"), "Cables");
    await user.click(screen.getByRole("button", { name: "Save template" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Return to inventory settings",
    );
    expect(callbacks.onConflict).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Name")).toHaveValue("Cables");
    expect(
      screen.getByRole("button", { name: "Save template" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(callbacks.onClose).toHaveBeenCalledOnce();
    expect(saveInventoryTemplate).toHaveBeenCalledOnce();
  },
);

// Synchronous duplicate-submit and dismissal guards keep one pending write mounted.
test("blocks duplicate submissions and dismissal until saving completes", async () => {
  const user = userEvent.setup();
  let finish!: (
    value: Awaited<ReturnType<typeof saveInventoryTemplate>>,
  ) => void;
  vi.mocked(saveInventoryTemplate).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const callbacks = open();
  await user.type(screen.getByLabelText("Name"), "Cables");
  const form = screen.getByLabelText("Name").closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(saveInventoryTemplate).toHaveBeenCalledOnce());
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(callbacks.onClose).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Name")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await act(async () =>
    finish({
      id: "template",
      revision: 1,
      name: "Cables",
      description: null,
      fields: [],
      created_at: "",
      updated_at: "",
    }),
  );
  await waitFor(() => expect(callbacks.onSaved).toHaveBeenCalledOnce());
});

// Verify the source action remains understandable in the German interface.
test("localizes the metadata dialog and cancels without writing", async () => {
  await i18n.changeLanguage("de");
  const user = userEvent.setup();
  const callbacks = open();
  expect(
    screen.getByRole("dialog", { name: "Inventar als Vorlage speichern" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Vorlage speichern" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Abbrechen" }));
  expect(callbacks.onClose).toHaveBeenCalledOnce();
  expect(saveInventoryTemplate).not.toHaveBeenCalled();
});
