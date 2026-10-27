import { apiBaseUrl, request } from "./api";
import type { InventoryAttachment } from "../types/inventoryItem";

/**
 * Build a field-scoped attachment endpoint from opaque identifiers.
 * @param inventoryId The parent inventory.
 * @param fieldId The files field.
 * @returns Its relative upload endpoint.
 */
function attachmentPath(inventoryId: string, fieldId: string) {
  return `/inventories/${encodeURIComponent(inventoryId)}/fields/${encodeURIComponent(fieldId)}/attachments`;
}

/**
 * Upload a File directly without converting it into a whole-file JavaScript buffer.
 * @param inventoryId The destination inventory.
 * @param fieldId The destination files field.
 * @param file The selected local file.
 * @returns An unclaimed managed copy, ready for the parent draft's atomic save.
 */
export function uploadAttachment(
  inventoryId: string,
  fieldId: string,
  file: File,
): Promise<InventoryAttachment> {
  return request(attachmentPath(inventoryId, fieldId), {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      "X-File-Type": file.type || "application/octet-stream",
    },
    body: file,
  });
}

/**
 * Discard a stage; the backend protects already-bound files after an uncertain save response.
 * @param file Metadata identifying the stage and its original field.
 * @returns Completion of the cancellation request.
 */
export function discardAttachment(file: InventoryAttachment): Promise<void> {
  return request(
    `${attachmentPath(file.inventory_id, file.field_id)}/${encodeURIComponent(file.id)}`,
    { method: "DELETE" },
  );
}

/**
 * Link to a streamed browser download, including for images; never buffer large downloads in memory.
 * @param file The file's public metadata.
 * @returns The backend endpoint that always forces attachment disposition.
 */
export function attachmentDownloadUrl(file: InventoryAttachment): string {
  return `${apiBaseUrl}${attachmentPath(file.inventory_id, file.field_id)}/${encodeURIComponent(file.id)}/download`;
}

/**
 * Start a streamed download explicitly in this browsing context, never a new tab.
 * @param file The file selected by the user.
 */
export function downloadAttachment(file: InventoryAttachment) {
  const link = document.createElement("a");
  link.href = attachmentDownloadUrl(file);
  link.download = file.filename;
  link.target = "_self";
  document.body.append(link);
  link.click();
  link.remove();
}
