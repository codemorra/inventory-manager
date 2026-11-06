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
