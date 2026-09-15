/** Represent an inventory field returned by the API. */
export interface InventoryField {
  id: string;
  inventory_id: string;
  name: string;
  field_type: string;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Define data accepted when creating an inventory field. */
export interface CreateInventoryFieldInput {
  name: string;
}

/** Define optional data accepted when updating an inventory field. */
export interface UpdateInventoryFieldInput {
  name?: string;
  position?: number;
}
