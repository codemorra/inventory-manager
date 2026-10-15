import type { Inventory } from "./inventory";
import type {
  CreateInventoryFieldInput,
  InventoryField,
  UpdateInventoryFieldInput,
} from "./inventoryField";

// Describe changes to saved fields or complete definitions for new draft fields.
export type FieldChange =
  | { action: "create"; client_id?: string; data: CreateInventoryFieldInput }
  | { action: "update"; field_id: string; data: UpdateInventoryFieldInput }
  | { action: "delete"; field_id: string };

// Describe changes to options belonging to existing fields.
export type OptionChange =
  | { action: "create"; field_id: string; data: { name: string } }
  | {
      action: "update";
      field_id: string;
      option_id: string;
      data: { name: string };
    }
  | { action: "delete"; field_id: string; option_id: string };

// Keep editor metadata independent of group membership changes.
export interface InventoryEditorInput {
  inventory: { name: string; description: string | null };
  fields: FieldChange[];
  options: OptionChange[];
  field_order?: ({ field_id: string } | { client_id: string })[];
}

// Represent the saved inventory and its complete active field configuration.
export interface InventoryEditorResult {
  inventory: Inventory;
  fields: InventoryField[];
}
