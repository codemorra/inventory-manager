import type { AppDatabase } from "../db/types.js";
import { DomainError } from "../errors.js";
import type { FieldService } from "../fields/service.js";
import { supportsOptions } from "../fields/validation.js";
import { createOptionRepository } from "./repository.js";
import { optionCreateSchema, optionUpdateSchema } from "./validation.js";

/**
 * Creates a service for managing inventory field options.
 * @param db - The application's database connection.
 * @param fields - The service for managing inventory fields.
 * @returns An object with methods to list, create, update, and delete options.
 */
export function createOptionService(db: AppDatabase, fields: FieldService) {
  const repository = createOptionRepository(db);
  function requireSelectable(inventoryId: string, fieldId: string) {
    const field = fields.get(inventoryId, fieldId);
    if (!supportsOptions(field.fieldType))
      throw new DomainError(
        "inventory_field_options_not_supported",
        "Inventory field type does not support options.",
      );
  }

  /**
   * Ensures that the specified field supports options.
   * @param inventoryId - The ID of the inventory.
   * @param fieldId - The ID of the field.
   * @throws {DomainError} If the field does not support options.
   */
  function get(inventoryId: string, fieldId: string, optionId: string) {
    requireSelectable(inventoryId, fieldId);
    const option = repository.find(fieldId, optionId);
    if (!option)
      throw new DomainError(
        "inventory_field_option_not_found",
        "Inventory field option not found.",
      );
    return option;
  }

  return {
    list(inventoryId: string, fieldId: string) {
      fields.get(inventoryId, fieldId);
      return repository.list(fieldId);
    },
    create(inventoryId: string, fieldId: string, input: unknown) {
      const data = optionCreateSchema.parse(input);
      requireSelectable(inventoryId, fieldId);
      return db.transaction((transaction) => {
        const options = createOptionRepository(transaction);
        return options.create({
          fieldId,
          name: data.name,
          position: options.count(fieldId),
        });
      });
    },
    update(
      inventoryId: string,
      fieldId: string,
      optionId: string,
      input: unknown,
    ) {
      const data = optionUpdateSchema.parse(input);
      const option = get(inventoryId, fieldId, optionId);
      return data.name != null && data.name !== option.name
        ? repository.rename(fieldId, optionId, data.name)
        : option;
    },
    delete(inventoryId: string, fieldId: string, optionId: string) {
      get(inventoryId, fieldId, optionId);
      repository.tombstone(fieldId, optionId);
    },
  };
}
