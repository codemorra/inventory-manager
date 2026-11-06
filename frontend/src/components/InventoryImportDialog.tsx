import { useState } from "react";
import type { InventoryImportFormat } from "../types/tableImport";
import { InventoryArchiveImportDialog } from "./InventoryArchiveImportDialog";
import { TableImportDialog } from "./TableImportDialog";

/** Keep ZIP as the default while preserving each import's uncertain receipt across dialog dismissal. */
export function InventoryImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<InventoryImportFormat>("zip");
  function close(retain = false) {
    if (!retain) setFormat("zip");
    onClose();
  }
  return (
    <>
      <InventoryArchiveImportDialog
        open={open && format === "zip"}
        onClose={close}
        onFormatChange={setFormat}
      />
      <TableImportDialog
        open={open && format !== "zip"}
        format={format === "markdown" ? "markdown" : "csv"}
        onClose={close}
        onFormatChange={setFormat}
      />
    </>
  );
}
