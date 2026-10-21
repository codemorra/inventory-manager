/** Represent a stored value of an inventory item field. */
export interface InventoryItemValue {
  id: string;
  field_id: string;
  value: unknown;
  created_at: string;
  updated_at: string;
}

/** Represent an inventory item returned by the API. */
export interface InventoryItem {
  id: string;
  inventory_id: string;
  revision: number;
  values: InventoryItemValue[];
  created_at: string;
  updated_at: string;
}

/** Define an inventory item value sent to the API. */
export interface InventoryItemValueInput {
  field_id: string;
  value: unknown;
}

/** Define inventory item values sent when creating or replacing an item. */
export interface InventoryItemInput {
  values: InventoryItemValueInput[];
}

// Require the revision captured when the edit or checkbox operation began.
export interface UpdateInventoryItemInput extends InventoryItemInput {
  expected_revision: number;
}
