import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InventoryImportDialog } from "../../src/components/InventoryImportDialog";
import * as archives from "../../src/services/inventoryArchives";
import { getInventoryGroups } from "../../src/services/inventoryGroups";
import { ApiError } from "../../src/services/api";
import {
  archivePreview,
  deferred,
  importedInventory,
} from "../helpers/inventoryArchives";
import type { InventoryImportPreview } from "../../src/types/inventoryArchive";
import type { Inventory } from "../../src/types/inventory";

vi.mock("../../src/services/inventoryArchives", () => ({
  prepareInventoryImport: vi.fn(),
  readInventoryImport: vi.fn(),
  confirmInventoryImport: vi.fn(),
  discardInventoryImport: vi.fn(),
}));
vi.mock("../../src/services/inventoryGroups", () => ({
  getInventoryGroups: vi
    .fn()
    .mockResolvedValue([{ id: "group", name: "Local group" }]),
}));
beforeEach(() => {
  vi.mocked(getInventoryGroups).mockResolvedValue([
    { id: "group", name: "Local group", created_at: "", updated_at: "" },
  ]);
  vi.mocked(archives.prepareInventoryImport).mockResolvedValue(
    structuredClone(archivePreview),
  );
  vi.mocked(archives.confirmInventoryImport).mockResolvedValue(
    importedInventory,
  );
  vi.mocked(archives.discardInventoryImport).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/** Mount the shell-owned dialog across visibility changes with real router/query behavior. */
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
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Harness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, refresh };
}
async function upload(
  user: ReturnType<typeof userEvent.setup>,
  name = "inventory.zip",
) {
  const file = new File(["zip"], name, { type: "application/zip" });
  await user.upload(screen.getByLabelText("Archive file (.zip)"), file);
  await screen.findByLabelText("Name");
  return file;
}

// Preview is read-only until explicit confirmation, which uses editable destination metadata and refreshes navigation.
test("shows a summary, imports once with metadata/group overrides and navigates to the saved inventory", async () => {
  const user = userEvent.setup();
  const { refresh } = show();
  const file = await upload(user);
  expect(archives.prepareInventoryImport).toHaveBeenCalledWith(
    file,
    expect.any(AbortSignal),
  );
  expect(screen.getByLabelText("Import summary")).toHaveTextContent(
    "Fields3Items7Files2File size4 KiB",
  );
  expect(screen.getByLabelText("Name")).toHaveValue("Cables");
  expect(screen.getByLabelText("Description")).toHaveValue("Saved inventory");
  expect(archives.confirmInventoryImport).not.toHaveBeenCalled();
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Independent copy");
  await user.click(screen.getByRole("combobox", { name: "Group" }));
  await user.click(await screen.findByRole("option", { name: "Local group" }));
  await user.click(screen.getByRole("button", { name: "Import" }));
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventories/imported/items",
    ),
  );
  expect(archives.confirmInventoryImport).toHaveBeenCalledExactlyOnceWith(
    "preview",
    {
      name: "Independent copy",
      description: "Saved inventory",
      group_id: "group",
    },
  );
  expect(refresh).toHaveBeenCalledWith({
    queryKey: ["inventories"],
    exact: true,
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

// Cancel aborts a pending copy; even a late backend success is discarded rather than appearing in a reopened dialog.
test("aborts canceled checking and cleans late preview completions", async () => {
  const pending = deferred<InventoryImportPreview>();
  vi.mocked(archives.prepareInventoryImport).mockReturnValue(pending.promise);
  const user = userEvent.setup();
  show();
  await user.upload(
    screen.getByLabelText("Archive file (.zip)"),
    new File(["zip"], "old.zip"),
  );
  expect(screen.getByRole("status")).toHaveTextContent("Copying and checking");
  const signal = vi.mocked(archives.prepareInventoryImport).mock.calls[0]![1]!;
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(archivePreview));
  expect(archives.discardInventoryImport).toHaveBeenCalledWith("preview");
  await user.click(screen.getByRole("button", { name: "Open import" }));
  expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  expect(archives.confirmInventoryImport).not.toHaveBeenCalled();
});

// A second selection invalidates the first request without losing the newest validated snapshot.
test("replaces previews safely when archive replies arrive out of order", async () => {
  const first = deferred<InventoryImportPreview>();
  vi.mocked(archives.prepareInventoryImport)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({
      ...archivePreview,
      id: "new",
      inventory: { name: "New", description: null },
    });
  const user = userEvent.setup();
  show();
  await user.upload(
    screen.getByLabelText("Archive file (.zip)"),
    new File(["old"], "old.zip"),
  );
  await upload(user, "new.zip");
  await act(async () => first.resolve({ ...archivePreview, id: "old" }));
  expect(screen.getByLabelText("Name")).toHaveValue("New");
  expect(archives.discardInventoryImport).toHaveBeenCalledWith("old");
});

// Confirmation cannot be duplicated or dismissed while it may be publishing a new inventory.
test("blocks duplicate submit, file replacement and dismissal during confirmation", async () => {
  const pending = deferred<Inventory>();
  vi.mocked(archives.confirmInventoryImport).mockReturnValue(pending.promise);
  const user = userEvent.setup();
  show();
  await upload(user);
  await user.dblClick(screen.getByRole("button", { name: "Import" }));
  expect(archives.confirmInventoryImport).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Archive file (.zip)")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await act(async () => pending.resolve(importedInventory));
});

// Lost responses freeze the captured request and recover its receipt even after closing/reopening the dialog.
test("recovers a lost confirmation response without creating another inventory", async () => {
  vi.mocked(archives.confirmInventoryImport).mockRejectedValue(
    new TypeError("Network failure"),
  );
  vi.mocked(archives.readInventoryImport).mockResolvedValue({
    ...archivePreview,
    status: "completed",
    inventory_id: "already-imported",
  });
  const user = userEvent.setup();
  show();
  await upload(user);
  await user.click(screen.getByRole("button", { name: "Import" }));
  await screen.findByRole("button", { name: "Check status" });
  expect(screen.getByLabelText("Name")).toBeDisabled();
  expect(screen.getByLabelText("Archive file (.zip)")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(archives.discardInventoryImport).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Open import" }));
  await user.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventories/already-imported/items",
    ),
  );
  expect(archives.confirmInventoryImport).toHaveBeenCalledOnce();
  expect(archives.prepareInventoryImport).toHaveBeenCalledOnce();
});

// Authoritative ready status restores the existing preview rather than uploading another archive.
test("preserves inputs while recovering importing/ready status and retries the same stage", async () => {
  vi.mocked(archives.confirmInventoryImport)
    .mockRejectedValueOnce(new TypeError("Network failure"))
    .mockResolvedValueOnce(importedInventory);
  vi.mocked(archives.readInventoryImport)
    .mockResolvedValueOnce({ ...archivePreview, status: "importing" })
    .mockResolvedValueOnce(archivePreview);
  const user = userEvent.setup();
  show();
  await upload(user);
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Kept name");
  await user.click(screen.getByRole("button", { name: "Import" }));
  await user.click(await screen.findByRole("button", { name: "Check status" }));
  expect(screen.getByRole("alert")).toHaveTextContent("still running");
  await user.click(screen.getByRole("button", { name: "Check status" }));
  expect(screen.getByLabelText("Name")).toHaveValue("Kept name");
  expect(screen.getByLabelText("Name")).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Import" }));
  expect(archives.confirmInventoryImport).toHaveBeenCalledTimes(2);
  expect(vi.mocked(archives.confirmInventoryImport).mock.calls[0]).toEqual(
    vi.mocked(archives.confirmInventoryImport).mock.calls[1],
  );
  expect(archives.prepareInventoryImport).toHaveBeenCalledOnce();
});

// Known recoverable failures retain the user's metadata and ready stage.
test("retains the draft on destination validation errors", async () => {
  vi.mocked(archives.confirmInventoryImport).mockRejectedValue(
    new ApiError(404, "Missing group", "inventory_group_not_found"),
  );
  const user = userEvent.setup();
  show();
  await upload(user);
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Kept");
  await user.click(screen.getByRole("button", { name: "Import" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "selected group no longer exists",
  );
  expect(screen.getByLabelText("Name")).toHaveValue("Kept");
  expect(screen.getByLabelText("Name")).toBeEnabled();
  expect(archives.discardInventoryImport).not.toHaveBeenCalled();
});

// An expired or lost receipt requires an explicit new file choice; no automatic duplication is attempted.
test("handles missing recovery status without automatically reimporting", async () => {
  vi.mocked(archives.confirmInventoryImport).mockRejectedValue(
    new TypeError("Network failure"),
  );
  vi.mocked(archives.readInventoryImport).mockRejectedValue(
    new ApiError(404, "Expired", "inventory_import_not_found"),
  );
  const user = userEvent.setup();
  const { refresh } = show();
  await upload(user);
  await user.click(screen.getByRole("button", { name: "Import" }));
  await user.click(await screen.findByRole("button", { name: "Check status" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Check your inventory list",
  );
  expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  expect(screen.getByLabelText("Archive file (.zip)")).toBeEnabled();
  expect(refresh).toHaveBeenCalledWith({
    queryKey: ["inventories"],
    exact: true,
  });
  expect(archives.confirmInventoryImport).toHaveBeenCalledOnce();
});

// New archives can replace known invalid data, and unmounting a ready preview only cancels its staging.
test("shows translated archive errors and cleans a ready session on unmount", async () => {
  vi.mocked(archives.prepareInventoryImport)
    .mockRejectedValueOnce(
      new ApiError(422, "Future", "unsupported_inventory_archive_version"),
    )
    .mockResolvedValueOnce(archivePreview);
  const user = userEvent.setup();
  const view = show();
  await user.upload(
    screen.getByLabelText("Archive file (.zip)"),
    new File(["bad"], "bad.zip"),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "format version is not supported",
  );
  await upload(user);
  view.unmount();
  expect(archives.discardInventoryImport).toHaveBeenCalledWith("preview");
});

// Expiry is checked locally as well as by the backend before confirming.
test("does not submit an already expired preview", async () => {
  vi.mocked(archives.prepareInventoryImport).mockResolvedValue({
    ...archivePreview,
    expires_at: "2000-01-01T00:00:00Z",
  });
  const user = userEvent.setup();
  show();
  await upload(user);
  await user.click(screen.getByRole("button", { name: "Import" }));
  expect(screen.getByRole("alert")).toHaveTextContent("preview has expired");
  expect(archives.confirmInventoryImport).not.toHaveBeenCalled();
});

// Offline status checks must not unlock the uncertain request or allow selecting another archive.
test("keeps an uncertain import frozen when status recovery is temporarily unavailable", async () => {
  vi.mocked(archives.confirmInventoryImport).mockRejectedValue(
    new ApiError(500, "Storage error"),
  );
  vi.mocked(archives.readInventoryImport)
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce({
      ...archivePreview,
      status: "completed",
      inventory_id: "recovered",
    });
  const user = userEvent.setup();
  show();
  await upload(user);
  await user.click(screen.getByRole("button", { name: "Import" }));
  await user.click(await screen.findByRole("button", { name: "Check status" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "status could not be checked",
  );
  expect(screen.getByLabelText("Name")).toBeDisabled();
  expect(screen.getByLabelText("Archive file (.zip)")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventories/recovered/items",
    ),
  );
  expect(archives.confirmInventoryImport).toHaveBeenCalledOnce();
});
