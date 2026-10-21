/** Represent an inventory returned by the API. */
export interface Inventory {
  id: string;
  configuration_revision: number;
  name: string;
  description: string | null;
  group_id?: string | null;
  created_at: string;
  updated_at: string;
}

/** Define data accepted when creating an inventory. */
export interface CreateInventoryInput {
  name: string;
  description?: string | null;
  group_id?: string | null;
}

/** Define optional fields accepted when updating an inventory. */
export interface UpdateInventoryInput {
  name?: string;
  description?: string | null;
  group_id?: string | null;
}
