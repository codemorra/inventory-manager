/** Represent an inventory returned by the API. */
export interface Inventory {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

/** Define data accepted when creating an inventory. */
export interface CreateInventoryInput {
  name: string;
  description?: string | null;
}

/** Define optional fields accepted when updating an inventory. */
export interface UpdateInventoryInput {
  name?: string;
  description?: string | null;
}
