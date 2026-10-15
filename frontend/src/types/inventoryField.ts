/** Define supported inventory field types. */
export type InventoryFieldType =
  | "text"
  | "number"
  | "id"
  | "url"
  | "boolean"
  | "checkbox"
  | "date"
  | "time"
  | "datetime"
  | "duration"
  | "select"
  | "multiselect";

/** Represent a selectable option returned by the API. */
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
  is_required: boolean;
  is_sortable: boolean;
  reuse_deleted_ids?: boolean;
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
  is_required?: boolean;
  is_sortable?: boolean;
  reuse_deleted_ids?: boolean;
}

/** Define optional data accepted when updating an inventory field. */
export interface UpdateInventoryFieldInput {
  name?: string;
  position?: number;
  is_required?: boolean;
  is_sortable?: boolean;
  reuse_deleted_ids?: boolean;
}

/** Define data accepted when creating an inventory field option. */
export interface CreateInventoryFieldOptionInput {
  name: string;
}

/** Define optional data accepted when updating an inventory field option. */
export interface UpdateInventoryFieldOptionInput {
  name?: string;
}
