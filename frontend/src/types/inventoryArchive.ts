import type { CreateInventoryInput } from "./inventory";

// Define the supported saved inventory export formats.
export type InventoryExportFormat = "zip" | "csv" | "markdown";

// Preview information for an inventory export
export interface PreparedInventoryExport {
  id: string;
  filename: string;
  byte_size: number;
  omitted_attachment_fields: number;
  expires_at: string;
}

// Preview information for an inventory import
export interface InventoryImportPreview {
  id: string;
  expires_at: string;
  inventory: { name: string; description: string | null };
  field_count: number;
  item_count: number;
  attachment_count: number;
  attachment_bytes: number;
  status: "ready" | "importing" | "completed";
  inventory_id?: string;
}

export type InventoryImportInput = Partial<CreateInventoryInput>;
