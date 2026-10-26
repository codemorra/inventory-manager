import type { InventoryFieldType } from "./inventoryField";
import type { CreateInventoryInput } from "./inventory";

// Ordered structure definitions contain no source IDs, counters, or item values.
export interface InventoryTemplateField {
  name: string;
  field_type: InventoryFieldType;
  max_length: number | null;
  is_required: boolean;
  is_sortable: boolean;
  reuse_deleted_ids: boolean;
  options: { name: string }[];
}

export interface InventoryTemplate {
  id: string;
  name: string;
  description: string | null;
  revision: number;
  fields: InventoryTemplateField[];
  created_at: string;
  updated_at: string;
}

// Capture the saved source revision rather than translating an unsaved editor draft.
export interface SaveInventoryTemplateInput {
  name: string;
  description: string | null;
  source_inventory_id: string;
  expected_configuration_revision: number;
}

export interface InstantiateInventoryTemplateInput extends CreateInventoryInput {
  expected_revision: number;
  field_indexes?: number[];
}
