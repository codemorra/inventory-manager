export interface InventoryField {
  id: string;
  inventory_id: string;
  name: string;
  field_type: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CreateInventoryFieldInput {
  name: string;
}

export interface UpdateInventoryFieldInput {
  name?: string;
  position?: number;
}
