import type {
  InventoryImportPreview,
  PreparedInventoryExport,
} from "../../src/types/inventoryArchive";
import type { Inventory } from "../../src/types/inventory";

export const archivePreview: InventoryImportPreview = {
  id: "preview",
  expires_at: "2099-01-01T00:00:00.000Z",
  inventory: { name: "Cables", description: "Saved inventory" },
  field_count: 3,
  item_count: 7,
  attachment_count: 2,
  attachment_bytes: 4096,
  status: "ready",
};
export const archiveExport: PreparedInventoryExport = {
  id: "export",
  filename: "Cables.zip",
  byte_size: 1024,
  expires_at: "2099-01-01T00:00:00.000Z",
};
export const importedInventory: Inventory = {
  id: "imported",
  configuration_revision: 1,
  name: "Cables",
  description: "Saved inventory",
  group_id: null,
  created_at: "",
  updated_at: "",
};

/** Keep a mocked network reply pending until a lifecycle test explicitly resolves it. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
