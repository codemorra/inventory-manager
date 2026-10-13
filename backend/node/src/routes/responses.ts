import type {
  inventories,
  inventoryFields,
  inventoryFieldOptions,
} from "../db/schema.js";

type Inventory = typeof inventories.$inferSelect;
type Option = typeof inventoryFieldOptions.$inferSelect;
type Field = typeof inventoryFields.$inferSelect & { options: Option[] };

/**
 * Transforms a database inventory record into a frontend-friendly response object.
 * @param inventory - The inventory record from the database.
 * @returns A frontend-friendly inventory response object.
 */
export function inventoryResponse(inventory: Inventory) {
  return {
    id: inventory.id,
    name: inventory.name,
    description: inventory.description,
    created_at: inventory.createdAt,
    updated_at: inventory.updatedAt,
  };
}

/**
 * Transforms a database inventory field option record into a frontend-friendly response object.
 * @param option - The inventory field option record from the database.
 * @returns A frontend-friendly inventory field option response object.
 */
export function optionResponse(option: Option) {
  return {
    id: option.id,
    field_id: option.fieldId,
    name: option.name,
    position: option.position,
    created_at: option.createdAt,
    updated_at: option.updatedAt,
  };
}

/**
 * Transforms a database inventory field record into a frontend-friendly response object.
 * @param field - The inventory field record from the database.
 * @returns A frontend-friendly inventory field response object.
 */
export function fieldResponse(field: Field) {
  return {
    id: field.id,
    inventory_id: field.inventoryId,
    name: field.name,
    field_type: field.fieldType,
    max_length: field.maxLength,
    options: field.options.map(optionResponse),
    position: field.position,
    created_at: field.createdAt,
    updated_at: field.updatedAt,
  };
}
