export interface InventoryItemValue {
  id: string;
  field_id: string;
  value: unknown;
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: string;
  inventory_id: string;
  values: InventoryItemValue[];
  created_at: string;
  updated_at: string;
}

export interface InventoryItemValueInput {
  field_id: string;
  value: unknown;
}

export interface InventoryItemInput {
  values: InventoryItemValueInput[];
}
