import type { InventoryField } from "../../src/types/inventoryField";
import type {
  InventoryAttachment,
  InventoryItem,
} from "../../src/types/inventoryItem";

export const attachmentField: InventoryField = {
  id: "files",
  inventory_id: "inventory",
  name: "Files",
  field_type: "attachment",
  max_length: null,
  is_required: false,
  is_sortable: true,
  options: [],
  position: 1,
  created_at: "",
  updated_at: "",
};
export const titleField: InventoryField = {
  ...attachmentField,
  id: "title",
  name: "Title",
  field_type: "text",
  max_length: 255,
  position: 0,
};

/**
 * Build public metadata, keeping stage and saved ownership explicit in each test.
 * @param id The opaque file identity.
 * @param overrides Per-test filename, ownership, or type changes.
 * @returns A synthetic managed-file metadata record.
 */
export function attachment(
  id = "file",
  overrides: Partial<InventoryAttachment> = {},
): InventoryAttachment {
  return {
    id,
    inventory_id: "inventory",
    field_id: "files",
    item_id: null,
    filename: `${id}.txt`,
    media_type: "text/plain",
    byte_size: 10,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

export const savedAttachment = attachment("saved", { item_id: "item" });
export const savedItem: InventoryItem = {
  id: "item",
  inventory_id: "inventory",
  revision: 4,
  values: [
    {
      id: "title-value",
      field_id: "title",
      value: "Original",
      created_at: "",
      updated_at: "",
    },
    {
      id: "file-value",
      field_id: "files",
      value: [savedAttachment.id],
      created_at: "",
      updated_at: "",
    },
  ],
  attachments: [savedAttachment],
  created_at: "",
  updated_at: "",
};
