export type InventoryFieldType =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "time"
  | "datetime"
  | "duration"
  | "select"
  | "multiselect";

export interface InventoryFieldOption {
  id: string;
  field_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

/** Represent an inventory field returned by the API. */
export interface InventoryField {
  id: string;
  inventory_id: string;
  name: string;
  field_type: InventoryFieldType;
  max_length: number | null;
  options: InventoryFieldOption[];
  position: number;
  created_at: string;
  updated_at: string;
}

/** Define data accepted when creating an inventory field. */
export interface CreateInventoryFieldInput {
  name: string;
  field_type?: InventoryFieldType;
  max_length?: number;
  options?: CreateInventoryFieldOptionInput[];
}

/** Define optional data accepted when updating an inventory field. */
export interface UpdateInventoryFieldInput {
  name?: string;
  position?: number;
}

export interface CreateInventoryFieldOptionInput {
  name: string;
}

export interface UpdateInventoryFieldOptionInput {
  name?: string;
}
