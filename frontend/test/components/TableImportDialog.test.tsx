import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InventoryImportDialog } from "../../src/components/InventoryImportDialog";
import * as tables from "../../src/services/tableImports";
import { getInventoryGroups } from "../../src/services/inventoryGroups";
import { ApiError } from "../../src/services/api";
import { deferred, importedInventory } from "../helpers/inventoryArchives";
import type {
  TableImportPreview,
  TableImportRows,
  TableImportValidation,
} from "../../src/types/tableImport";
import type { Inventory } from "../../src/types/inventory";

vi.mock("../../src/services/tableImports", () => ({
  prepareTableImport: vi.fn(),
  readTableImportRows: vi.fn(),
  validateTableImport: vi.fn(),
  confirmTableImport: vi.fn(),
  readTableImport: vi.fn(),
  discardTableImport: vi.fn(),
}));
vi.mock("../../src/services/inventoryGroups", () => ({
  getInventoryGroups: vi.fn(),
}));
const preview: TableImportPreview = {
  id: "table",
  expires_at: "2099-01-01T00:00:00Z",
  format: "csv",
  column_count: 2,
  row_count: 2,
  status: "ready",
};
const page: TableImportRows = {
  offset: 0,
  limit: 50,
  total_rows: 2,
  headers: ["Code", "Ports"],
  rows: [
    ["00123", "USB; Power"],
    ["00456", "Power"],
  ],
};
beforeEach(() => {
  vi.mocked(getInventoryGroups).mockResolvedValue([
    { id: "group", name: "Local group", created_at: "", updated_at: "" },
  ]);
  vi.mocked(tables.prepareTableImport).mockResolvedValue(preview);
  vi.mocked(tables.readTableImportRows).mockResolvedValue(
    structuredClone(page),
  );
  vi.mocked(tables.validateTableImport).mockResolvedValue({
    valid: true,
    issues: [],
  });
  vi.mocked(tables.confirmTableImport).mockResolvedValue(importedInventory);
  vi.mocked(tables.discardTableImport).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/** Keep the dialog mounted through dismissal to exercise its receipt recovery in the real coordinator. */
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const refresh = vi.spyOn(client, "invalidateQueries");
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open import</button>
        <InventoryImportDialog open={open} onClose={() => setOpen(false)} />
        <p data-testid="location">{useLocation().pathname}</p>
      </>
    );
  }
  return {
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Harness />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
    refresh,
  };
}
async function choose(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  option: string,
) {
  if (label === "Import format") {
    await user.click(screen.getByRole("radio", { name: option }));
  } else {
    await user.click(screen.getByRole("combobox", { name: label }));
    await user.click(screen.getByRole("option", { name: option }));
  }
}
async function upload(
  user: ReturnType<typeof userEvent.setup>,
  name = "parts.csv",
) {
  const file = new File(["foreign table"], name);
  if (!screen.queryByLabelText("CSV file (.csv)"))
    await user.click(screen.getByRole("button", { name: "Change file" }));
  await user.upload(screen.getByLabelText("CSV file (.csv)"), file);
  await screen.findByLabelText("Field name for column 1");
  return file;
}
async function ready() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled(),
  );
}

// ZIP remains the initial choice; table imports start as literal text and only publish explicitly chosen fields.
test("defaults to ZIP and imports a foreign table with explicit mappings, skipped columns and metadata", async () => {
  const user = userEvent.setup();
  const { refresh } = show();
  expect(screen.getByRole("radio", { name: "ZIP" })).toBeChecked();
  expect(screen.getByLabelText("Archive file (.zip)")).toBeInTheDocument();
  await choose(user, "Import format", "CSV");
  const file = await upload(user);
  expect(screen.getByLabelText("Name")).toHaveValue("parts");
  expect(
    screen.getByRole("cell", { name: "Row 1, column 1" }),
  ).toHaveTextContent("00123");
  expect(
    screen.getByRole("cell", { name: "Row 1, column 2" }),
  ).toHaveTextContent("USB; Power");
  await ready();
  expect(tables.prepareTableImport).toHaveBeenCalledWith(
    file,
    "csv",
    ",",
    expect.any(AbortSignal),
  );
  expect(tables.validateTableImport).toHaveBeenLastCalledWith(
    "table",
    [
      { column: 0, name: "Code", field_type: "text" },
      { column: 1, name: "Ports", field_type: "text" },
    ],
    expect.any(AbortSignal),
  );
  await choose(user, "Field type for column 1", "Skip column");
  await choose(user, "Field type for column 2", "Multiple choice");
  expect(
    screen.getByLabelText("Multiple-choice separator for column 2"),
  ).toHaveValue(";");
  await user.clear(
    screen.getByLabelText("Multiple-choice separator for column 2"),
  );
  await user.type(
    screen.getByLabelText("Multiple-choice separator for column 2"),
    "|",
  );
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Foreign inventory");
  await user.type(
    screen.getByLabelText("Description"),
    "My data{Enter}Second line",
  );
  await choose(user, "Group", "Local group");
  await ready();
  expect(tables.confirmTableImport).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Import" }));
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventories/imported/items",
    ),
  );
  expect(tables.confirmTableImport).toHaveBeenCalledExactlyOnceWith("table", {
    name: "Foreign inventory",
    description: "My data\nSecond line",
    group_id: "group",
    columns: [
      { column: 1, name: "Ports", field_type: "multiselect", separator: "|" },
    ],
  });
  expect(refresh).toHaveBeenCalledWith({
    queryKey: ["inventories"],
    exact: true,
  });
  expect(tables.discardTableImport).toHaveBeenCalledExactlyOnceWith("table");
});

// A pending page request retains the existing table, mappings and scroll position until its rows arrive.
test("updates preview rows without replacing the table during pagination", async () => {
  const pending = deferred<TableImportRows>();
  vi.mocked(tables.prepareTableImport).mockResolvedValue({
    ...preview,
    row_count: 60,
  });
  vi.mocked(tables.readTableImportRows)
    .mockResolvedValueOnce({ ...page, total_rows: 60 })
    .mockReturnValueOnce(pending.promise);
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  const dialog = screen.getByRole("dialog");
  const table = screen.getByRole("table");
  const viewport = screen.getByLabelText("Table preview and field mapping");
  const fieldName = screen.getByLabelText("Field name for column 1");
  viewport.scrollLeft = 120;
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(screen.getByRole("table")).toBe(table);
  expect(
    screen.getByRole("cell", { name: "Row 1, column 1" }),
  ).toHaveTextContent("00123");
  expect(table.closest('[aria-busy="true"]')).toBeInTheDocument();
  expect(screen.queryByText("Loading preview page…")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  await act(async () =>
    pending.resolve({
      ...page,
      offset: 50,
      total_rows: 60,
      rows: [["00789", "HDMI"]],
    }),
  );
  expect(
    screen.getByRole("cell", { name: "Row 51, column 1" }),
  ).toHaveTextContent("00789");
  expect(
    screen.queryByRole("cell", { name: "Row 1, column 1" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(screen.getByRole("table")).toBe(table);
  expect(screen.getByLabelText("Field name for column 1")).toBe(fieldName);
  expect(viewport.scrollLeft).toBe(120);
  expect(table.closest('[aria-busy="false"]')).toBeInTheDocument();
  expect(screen.queryByText("Loading preview page…")).not.toBeInTheDocument();
});

// Error navigation crosses page boundaries while the source coordinates and chosen field definitions remain stable.
test("highlights invalid cells and jumps to errors outside the first preview page", async () => {
  vi.mocked(tables.prepareTableImport).mockResolvedValue({
    ...preview,
    row_count: 60,
  });
  vi.mocked(tables.readTableImportRows).mockImplementation(
    async (_id, offset) => ({
      ...page,
      offset,
      total_rows: 60,
      rows: Array.from({ length: offset ? 10 : 50 }, (_, index) => [
        offset + index === 59 ? "unknown" : String(offset + index),
        "USB",
      ]),
    }),
  );
  vi.mocked(tables.validateTableImport).mockImplementation(
    async (_id, columns) =>
      columns[0]?.field_type === "number"
        ? {
            valid: false,
            issues: [{ row: 59, column: 0, code: "invalid_value" }],
          }
        : { valid: true, issues: [] },
  );
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  await choose(user, "Field type for column 1", "Number");
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  expect(
    await screen.findByText(/Some values do not match/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next error" }));
  const cell = await screen.findByRole("cell", { name: "Row 60, column 1" });
  await waitFor(() => expect(cell).toHaveFocus());
  expect(cell).toHaveAttribute("aria-invalid", "true");
  expect(cell).toHaveClass("border-danger");
  expect(cell).toHaveTextContent("unknown");
  expect(cell).toHaveTextContent("Not a valid value for Number");
  expect(tables.readTableImportRows).toHaveBeenLastCalledWith(
    "table",
    50,
    50,
    expect.any(AbortSignal),
  );
  expect(screen.getByLabelText("Field name for column 1")).toHaveValue("Code");
  await choose(user, "Field type for column 1", "Text");
  await ready();
  expect(
    screen.queryByText(/Some values do not match/),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("cell", { name: "Row 60, column 1" }),
  ).not.toHaveAttribute("aria-invalid");
});

// Older validation replies cannot enable publication or overwrite results for the newest mapping.
test("ignores stale validation replies after a newer field type was selected", async () => {
  const pending = deferred<TableImportValidation>();
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  vi.mocked(tables.validateTableImport).mockReturnValueOnce(pending.promise);
  await choose(user, "Field type for column 1", "Number");
  await waitFor(() =>
    expect(tables.validateTableImport).toHaveBeenLastCalledWith(
      "table",
      expect.arrayContaining([
        expect.objectContaining({ field_type: "number" }),
      ]),
      expect.any(AbortSignal),
    ),
  );
  const signal = vi.mocked(tables.validateTableImport).mock.calls.at(-1)![2]!;
  await choose(user, "Field type for column 1", "Text");
  await ready();
  expect(signal.aborted).toBe(true);
  await act(async () =>
    pending.resolve({
      valid: false,
      issues: [{ row: 0, column: 0, code: "invalid_value" }],
    }),
  );
  expect(
    screen.queryByText(/Some values do not match/),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
});

// Loaded previews hide source settings until the user explicitly starts a fresh selection.
test("hides source controls after upload and returns to them when changing the file", async () => {
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  expect(
    screen.queryByRole("group", { name: "Import format" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("CSV file (.csv)")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "CSV column separator" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Change file" }));
  expect(tables.discardTableImport).toHaveBeenCalledWith("table");
  expect(screen.getByRole("radio", { name: "CSV" })).toBeChecked();
  expect(
    screen.queryByLabelText("Field name for column 1"),
  ).not.toBeInTheDocument();
  await choose(user, "CSV column separator", "Semicolon (;)");
  vi.mocked(tables.prepareTableImport).mockResolvedValueOnce({
    ...preview,
    id: "new-table",
  });
  const file = await upload(user);
  await ready();
  expect(tables.prepareTableImport).toHaveBeenLastCalledWith(
    file,
    "csv",
    ";",
    expect.any(AbortSignal),
  );
  expect(
    screen.queryByRole("group", { name: "Import format" }),
  ).not.toBeInTheDocument();
});

// Canceling or changing format invalidates pending uploads; a late token cannot reappear in a reopened dialog.
test("aborts canceled uploads, cleans late results and reopens with ZIP selected", async () => {
  const pending = deferred<TableImportPreview>();
  vi.mocked(tables.prepareTableImport).mockReturnValue(pending.promise);
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await user.upload(
    screen.getByLabelText("CSV file (.csv)"),
    new File(["data"], "parts.csv"),
  );
  const signal = vi.mocked(tables.prepareTableImport).mock.calls[0]![3]!;
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(preview));
  expect(tables.discardTableImport).toHaveBeenCalledWith("table");
  await user.click(screen.getByRole("button", { name: "Open import" }));
  expect(screen.getByLabelText("Archive file (.zip)")).toBeInTheDocument();
  expect(tables.readTableImportRows).not.toHaveBeenCalled();
});

// Markdown restrictions are explained specifically; CSV and ZIP controls are not confused with Markdown uploads.
test("offers supported field types and explains Markdown files containing extra content", async () => {
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  await user.click(
    screen.getByRole("combobox", { name: "Field type for column 1" }),
  );
  expect(screen.getByRole("option", { name: "Date" })).toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: "Date and time" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "URL" })).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Automatic ID" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Files" }),
  ).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Change file" }));
  await choose(user, "Import format", "Markdown");
  expect(tables.discardTableImport).toHaveBeenCalledWith("table");
  vi.mocked(tables.prepareTableImport).mockRejectedValueOnce(
    new ApiError(422, "Invalid", "invalid_markdown_table"),
  );
  const file = new File(["# Heading"], "notes.md");
  await user.upload(screen.getByLabelText("Markdown file (.md)"), file);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "exactly one valid pipe table and no other content",
  );
  expect(tables.prepareTableImport).toHaveBeenLastCalledWith(
    file,
    "markdown",
    ",",
    expect.any(AbortSignal),
  );
  expect(
    screen.queryByRole("combobox", { name: "CSV column separator" }),
  ).not.toBeInTheDocument();
});

// Blank names or skipping every field are configuration errors; they cannot submit stale successful validation.
test("blocks invalid field settings and resumes checking when they are corrected", async () => {
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  await user.clear(screen.getByLabelText("Field name for column 1"));
  expect(screen.getByLabelText("Field name for column 1")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  await user.type(screen.getByLabelText("Field name for column 1"), "Renamed");
  await ready();
  await choose(user, "Field type for column 1", "Skip column");
  await choose(user, "Field type for column 2", "Skip column");
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Select at least one column",
  );
  await choose(user, "Field type for column 2", "Text");
  await ready();
});

// The original stage remains recoverable after temporary page or validation failures.
test("retries failed preview loading and validation without uploading a second file", async () => {
  vi.mocked(tables.readTableImportRows).mockRejectedValueOnce(
    new TypeError("Offline"),
  );
  vi.mocked(tables.validateTableImport).mockRejectedValueOnce(
    new TypeError("Offline"),
  );
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await user.upload(
    screen.getByLabelText("CSV file (.csv)"),
    new File(["data"], "parts.csv"),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "preview page could not be loaded",
  );
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByLabelText("Field name for column 1");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "field mapping could not be checked",
  );
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await ready();
  expect(tables.prepareTableImport).toHaveBeenCalledOnce();
});

// Durable publication cannot be double-submitted, dismissed or replaced with a different interpretation.
test("blocks duplicate confirmation and dismissal while publication is pending", async () => {
  const pending = deferred<Inventory>();
  vi.mocked(tables.confirmTableImport).mockReturnValue(pending.promise);
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  await user.dblClick(screen.getByRole("button", { name: "Import" }));
  expect(tables.confirmTableImport).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("group", { name: "Import format" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Change file" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => pending.resolve(importedInventory));
});

// Uncertain receipts survive closing/reopening and are checked rather than blindly published a second time.
test("recovers a lost confirmation response after reopening the table dialog", async () => {
  vi.mocked(tables.confirmTableImport).mockRejectedValue(
    new TypeError("Offline"),
  );
  vi.mocked(tables.readTableImport).mockResolvedValue({
    ...preview,
    status: "completed",
    inventory_id: "recovered",
  });
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  await user.click(screen.getByRole("button", { name: "Import" }));
  await screen.findByRole("button", { name: "Check status" });
  expect(
    screen.queryByRole("group", { name: "Import format" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(tables.discardTableImport).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Open import" }));
  expect(screen.getByRole("button", { name: "Change file" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventories/recovered/items",
    ),
  );
  expect(tables.confirmTableImport).toHaveBeenCalledOnce();
  expect(tables.prepareTableImport).toHaveBeenCalledOnce();
});

// Authoritative ready status allows the same captured request to be retried with no changes to metadata or mappings.
test("retains mappings through importing and ready recovery and retries identical confirmation parameters", async () => {
  vi.mocked(tables.confirmTableImport)
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce(importedInventory);
  vi.mocked(tables.readTableImport)
    .mockResolvedValueOnce({ ...preview, status: "importing" })
    .mockResolvedValueOnce(preview);
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  await user.click(screen.getByRole("button", { name: "Import" }));
  await user.click(await screen.findByRole("button", { name: "Check status" }));
  expect(screen.getByRole("alert")).toHaveTextContent("still running");
  await user.click(screen.getByRole("button", { name: "Check status" }));
  await ready();
  await user.click(screen.getByRole("button", { name: "Import" }));
  expect(tables.confirmTableImport).toHaveBeenCalledTimes(2);
  expect(vi.mocked(tables.confirmTableImport).mock.calls[0]).toEqual(
    vi.mocked(tables.confirmTableImport).mock.calls[1],
  );
});

// Expired previews and unavailable receipts require an explicit new file selection rather than automatic duplication.
test("requires a new selection after expiry or a missing recovery receipt", async () => {
  vi.mocked(tables.prepareTableImport).mockResolvedValueOnce({
    ...preview,
    expires_at: "2000-01-01T00:00:00Z",
  });
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  await user.click(screen.getByRole("button", { name: "Import" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "table preview has expired",
  );
  expect(tables.confirmTableImport).not.toHaveBeenCalled();
  await upload(user);
  await ready();
  vi.mocked(tables.confirmTableImport).mockRejectedValueOnce(
    new TypeError("Offline"),
  );
  vi.mocked(tables.readTableImport).mockRejectedValueOnce(
    new ApiError(404, "Missing", "inventory_import_not_found"),
  );
  await user.click(screen.getByRole("button", { name: "Import" }));
  await user.click(await screen.findByRole("button", { name: "Check status" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Check your inventory list",
  );
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Change file" })).toBeEnabled();
  expect(tables.confirmTableImport).toHaveBeenCalledOnce();
});

// Normalized field-name edits retain the matching validation result instead of waiting for a nonexistent new check.
test("keeps an already validated mapping usable after a trailing-space name edit", async () => {
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  const checks = vi.mocked(tables.validateTableImport).mock.calls.length;
  await user.type(screen.getByLabelText("Field name for column 1"), " ");
  expect(screen.getByLabelText("Field name for column 1")).toHaveValue("Code ");
  expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  expect(tables.validateTableImport).toHaveBeenCalledTimes(checks);
});

// Brief mapping guidance remains visible while detailed format rules are available on demand.
test("keeps format guidance collapsed until requested", async () => {
  const user = userEvent.setup();
  show();
  await choose(user, "Import format", "CSV");
  await upload(user);
  await ready();
  expect(screen.getByText("Choose field types or skip columns.")).toBeVisible();
  const explanation = screen.getByText(/Number: Use 12.5 rather than 12,5/);
  expect(explanation).not.toBeVisible();
  await user.click(screen.getByText("Which values match each field type?"));
  expect(explanation).toBeVisible();
  expect(screen.getByLabelText("Description").tagName).toBe("TEXTAREA");
});
