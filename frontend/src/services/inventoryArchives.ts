import { apiBaseUrl, request } from "./api";
import type { Inventory } from "../types/inventory";
import type {
  InventoryImportInput,
  InventoryImportPreview,
  PreparedInventoryExport,
} from "../types/inventoryArchive";

const exportPath = (inventoryId: string) =>
  `/inventories/${encodeURIComponent(inventoryId)}/exports`;
const importPath = (id: string) =>
  `/inventory-imports/${encodeURIComponent(id)}`;

/** Prepare a complete saved inventory archive without fetching its large binary body. */
export function prepareInventoryExport(
  inventoryId: string,
  signal?: AbortSignal,
): Promise<PreparedInventoryExport> {
  return request(exportPath(inventoryId), {
    method: "POST",
    ...(signal ? { signal } : {}),
  });
}

/** Discard an unused completed export. */
export function discardInventoryExport(
  inventoryId: string,
  id: string,
): Promise<void> {
  return request(`${exportPath(inventoryId)}/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Return the single-use native download URL, scoped to its source inventory. */
export function inventoryExportDownloadUrl(inventoryId: string, id: string) {
  return `${apiBaseUrl}${exportPath(inventoryId)}/${encodeURIComponent(id)}/download`;
}

/** Download a completed archive directly; never convert it into a Blob or whole-file JS buffer. */
export function downloadInventoryExport(
  inventoryId: string,
  prepared: PreparedInventoryExport,
) {
  const link = document.createElement("a");
  link.href = inventoryExportDownloadUrl(inventoryId, prepared.id);
  link.download = prepared.filename;
  link.target = "_self";
  document.body.append(link);
  link.click();
  link.remove();
}

/** Send the original File directly to the backend's streamed archive preview endpoint. */
export function prepareInventoryImport(
  file: File,
  signal?: AbortSignal,
): Promise<InventoryImportPreview> {
  return request("/inventory-imports", {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: file,
    ...(signal ? { signal } : {}),
  });
}

/** Read authoritative preview/publication status after an uncertain confirmation response. */
export function readInventoryImport(
  id: string,
): Promise<InventoryImportPreview> {
  return request(importPath(id));
}

/** Confirm the exact validated archive, using the same token and metadata for uncertain retries. */
export function confirmInventoryImport(
  id: string,
  data: InventoryImportInput,
): Promise<Inventory> {
  return request(`${importPath(id)}/confirm`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/** Discard a ready preview or completed receipt; the backend protects in-progress/committed inventories. */
export function discardInventoryImport(id: string): Promise<void> {
  return request(importPath(id), { method: "DELETE" });
}
