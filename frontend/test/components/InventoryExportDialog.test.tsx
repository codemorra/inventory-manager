import { useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InventoryExportDialog } from "../../src/components/InventoryExportDialog";
import * as archives from "../../src/services/inventoryArchives";
import { ApiError } from "../../src/services/api";
import {
  archiveExport,
  deferred,
  importedInventory,
} from "../helpers/inventoryArchives";
import type { PreparedInventoryExport } from "../../src/types/inventoryArchive";
vi.mock("../../src/services/inventoryArchives", () => ({
  prepareInventoryExport: vi.fn(),
  discardInventoryExport: vi.fn(),
  downloadInventoryExport: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(archives.prepareInventoryExport).mockResolvedValue(archiveExport);
  vi.mocked(archives.discardInventoryExport).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function show() {
  const close = vi.fn();
  function Harness() {
    const [open, setOpen] = useState(true);
    return open ? (
      <InventoryExportDialog
        inventory={importedInventory}
        onClose={() => {
          close();
          setOpen(false);
        }}
      />
    ) : null;
  }
  return { ...render(<Harness />), close };
}

// Only a completed server artifact is offered for a native download, with no accidental discard after claiming it.
test("prepares a complete inventory and downloads only its ready archive", async () => {
  const user = userEvent.setup();
  const { close } = show();
  const download = await screen.findByRole("button", { name: "Download ZIP" });
  expect(screen.getByText(/Cables.zip/)).toHaveTextContent("1 KiB");
  expect(archives.prepareInventoryExport).toHaveBeenCalledWith(
    importedInventory.id,
    expect.any(AbortSignal),
    "zip",
  );
  expect(archives.downloadInventoryExport).not.toHaveBeenCalled();
  await user.click(download);
  expect(archives.downloadInventoryExport).toHaveBeenCalledExactlyOnceWith(
    importedInventory.id,
    archiveExport,
  );
  expect(close).toHaveBeenCalledOnce();
  expect(archives.discardInventoryExport).not.toHaveBeenCalled();
});

// Closing before readiness cancels the request and removes even a late reply from a backend that completed first.
test("aborts preparation on cancellation and discards late export replies", async () => {
  const pending = deferred<PreparedInventoryExport>();
  vi.mocked(archives.prepareInventoryExport).mockReturnValue(pending.promise);
  const user = userEvent.setup();
  show();
  const signal = vi.mocked(archives.prepareInventoryExport).mock.calls[0]![1]!;
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(archiveExport));
  expect(archives.discardInventoryExport).toHaveBeenCalledWith(
    importedInventory.id,
    archiveExport.id,
  );
  expect(archives.downloadInventoryExport).not.toHaveBeenCalled();
});

// A completed but unused artifact must not occupy scratch storage until expiry unnecessarily.
test("discards a ready export when its dialog is closed", async () => {
  const user = userEvent.setup();
  show();
  await screen.findByRole("button", { name: "Download ZIP" });
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(archives.discardInventoryExport).toHaveBeenCalledExactlyOnceWith(
    importedInventory.id,
    archiveExport.id,
  );
});

// The retry creates a fresh coherent snapshot after a source-change conflict.
test("explains source changes and allows an explicit retry", async () => {
  vi.mocked(archives.prepareInventoryExport)
    .mockRejectedValueOnce(
      new ApiError(409, "Changed", "inventory_export_conflict"),
    )
    .mockResolvedValueOnce(archiveExport);
  const user = userEvent.setup();
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "changed during export",
  );
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Download ZIP" });
  expect(archives.prepareInventoryExport).toHaveBeenCalledTimes(2);
});

// Never invoke a one-use expired URL; make preparation available again instead.
test("requires a fresh export after expiry", async () => {
  vi.mocked(archives.prepareInventoryExport).mockResolvedValue({
    ...archiveExport,
    expires_at: "2000-01-01T00:00:00Z",
  });
  const user = userEvent.setup();
  show();
  await user.click(await screen.findByRole("button", { name: "Download ZIP" }));
  expect(screen.getByRole("alert")).toHaveTextContent("export has expired");
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  expect(archives.downloadInventoryExport).not.toHaveBeenCalled();
});

// Format changes discard unused artifacts and warn about omitted attachment columns before downloading.
test.each([
  ["csv", "CSV – table", "Download CSV", "Cables.csv"],
  ["markdown", "Markdown – table", "Download Markdown", "Cables.md"],
] as const)(
  "downloads %s after format selection with an attachment notice",
  async (format, option, label, filename) => {
    const user = userEvent.setup();
    const { close } = show();
    await screen.findByRole("button", { name: "Download ZIP" });
    const table = {
      ...archiveExport,
      id: format,
      filename,
      omitted_attachment_fields: 2,
    };
    vi.mocked(archives.prepareInventoryExport).mockResolvedValueOnce(table);
    await user.click(screen.getByRole("combobox", { name: "Export format" }));
    await user.click(screen.getByRole("option", { name: option }));
    const download = await screen.findByRole("button", { name: label });
    expect(
      screen.queryByRole("button", { name: "Download ZIP" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(filename, { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "These columns and their files are excluded",
    );
    expect(
      screen.getByText(/independently of views and filters/),
    ).toBeInTheDocument();
    expect(archives.prepareInventoryExport).toHaveBeenLastCalledWith(
      importedInventory.id,
      expect.any(AbortSignal),
      format,
    );
    expect(archives.discardInventoryExport).toHaveBeenCalledExactlyOnceWith(
      importedInventory.id,
      archiveExport.id,
    );
    await user.click(download);
    expect(archives.downloadInventoryExport).toHaveBeenCalledExactlyOnceWith(
      importedInventory.id,
      table,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(archives.discardInventoryExport).toHaveBeenCalledTimes(1);
  },
);

// A stale response must neither replace the current format nor expose a download for the wrong artifact.
test("aborts replaced formats and discards late replies without changing the current download", async () => {
  const zip = deferred<PreparedInventoryExport>();
  const csv = deferred<PreparedInventoryExport>();
  const markdown = { ...archiveExport, id: "markdown", filename: "Cables.md" };
  vi.mocked(archives.prepareInventoryExport)
    .mockReturnValueOnce(zip.promise)
    .mockReturnValueOnce(csv.promise)
    .mockResolvedValueOnce(markdown);
  const user = userEvent.setup();
  show();
  const zipSignal = vi.mocked(archives.prepareInventoryExport).mock
    .calls[0]![1]!;
  await user.click(screen.getByRole("combobox", { name: "Export format" }));
  await user.click(screen.getByRole("option", { name: "CSV – table" }));
  expect(zipSignal.aborted).toBe(true);
  expect(
    screen.queryByRole("button", { name: /Download/ }),
  ).not.toBeInTheDocument();
  const csvSignal = vi.mocked(archives.prepareInventoryExport).mock
    .calls[1]![1]!;
  await user.click(screen.getByRole("combobox", { name: "Export format" }));
  await user.click(screen.getByRole("option", { name: "Markdown – table" }));
  await screen.findByRole("button", { name: "Download Markdown" });
  expect(csvSignal.aborted).toBe(true);
  await act(async () => {
    zip.resolve(archiveExport);
    csv.resolve({
      ...archiveExport,
      id: "csv",
      filename: "Cables.csv",
      omitted_attachment_fields: 1,
    });
  });
  expect(screen.queryByText(/Cables.csv/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Cables.zip/)).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(archives.discardInventoryExport).toHaveBeenCalledWith(
    importedInventory.id,
    archiveExport.id,
  );
  expect(archives.discardInventoryExport).toHaveBeenCalledWith(
    importedInventory.id,
    "csv",
  );
  await user.click(screen.getByRole("button", { name: "Download Markdown" }));
  expect(archives.downloadInventoryExport).toHaveBeenCalledExactlyOnceWith(
    importedInventory.id,
    markdown,
  );
});

// Table failures explain the column requirement, retain the selected format and allow returning to ZIP.
test("retries the selected table format and clears its error and attachment notice when returning to ZIP", async () => {
  const user = userEvent.setup();
  show();
  await screen.findByRole("button", { name: "Download ZIP" });
  vi.mocked(archives.prepareInventoryExport).mockRejectedValueOnce(
    new ApiError(422, "No columns", "inventory_export_unavailable"),
  );
  await user.click(screen.getByRole("combobox", { name: "Export format" }));
  await user.click(screen.getByRole("option", { name: "CSV – table" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "at least one field other than attachments",
  );
  vi.mocked(archives.prepareInventoryExport).mockResolvedValueOnce({
    ...archiveExport,
    id: "csv",
    filename: "Cables.csv",
    omitted_attachment_fields: 1,
  });
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Download CSV" });
  expect(archives.prepareInventoryExport).toHaveBeenLastCalledWith(
    importedInventory.id,
    expect.any(AbortSignal),
    "csv",
  );
  expect(screen.getByRole("status")).toHaveTextContent("attachment fields");
  await user.click(screen.getByRole("combobox", { name: "Export format" }));
  await user.click(
    screen.getByRole("option", { name: "ZIP – inventory archive" }),
  );
  await screen.findByRole("button", { name: "Download ZIP" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(archives.discardInventoryExport).toHaveBeenCalledWith(
    importedInventory.id,
    "csv",
  );
});

// Expiry must prepare another artifact in the chosen encoding rather than reverting to ZIP.
test("retains the Markdown selection when an expired download is retried", async () => {
  const user = userEvent.setup();
  show();
  await screen.findByRole("button", { name: "Download ZIP" });
  vi.mocked(archives.prepareInventoryExport).mockResolvedValueOnce({
    ...archiveExport,
    id: "expired",
    filename: "Cables.md",
    expires_at: "2000-01-01T00:00:00Z",
  });
  await user.click(screen.getByRole("combobox", { name: "Export format" }));
  await user.click(screen.getByRole("option", { name: "Markdown – table" }));
  await user.click(
    await screen.findByRole("button", { name: "Download Markdown" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("export has expired");
  expect(archives.downloadInventoryExport).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: "Download Markdown" });
  expect(archives.prepareInventoryExport).toHaveBeenLastCalledWith(
    importedInventory.id,
    expect.any(AbortSignal),
    "markdown",
  );
});
