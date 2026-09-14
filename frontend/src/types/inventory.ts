export interface Inventory {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateInventoryInput {
  name: string;
  description?: string | null;
}

export interface UpdateInventoryInput {
  name?: string;
  description?: string | null;
}
