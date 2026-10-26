import type {
  InventoryField,
  InventoryFieldType,
} from "../../src/types/inventoryField";
import type { InventoryItem } from "../../src/types/inventoryItem";
import type { ItemFilter } from "../../src/types/itemFilter";
import { itemFilterOperators } from "../../src/components/inventoryItemFilters";

/**
 * Build a filterable field with readable option labels and independent identifiers.
 * @param field_type The field semantics under test.
 * @param name The optional display name used in panel tests.
 * @returns A complete field definition with two selection options.
 */
export function filterField(
  field_type: InventoryFieldType,
  name: string = field_type,
): InventoryField {
  const id = `${field_type}-field`;
  return {
    id,
    inventory_id: "inventory",
    name,
    field_type,
    max_length: null,
    is_required: false,
    is_sortable: true,
    position: 0,
    created_at: "",
    updated_at: "",
    options: ["Adapter", "Cable"].map((name, index) => ({
      id: `option-${index}`,
      field_id: id,
      name,
      position: index,
      created_at: "",
      updated_at: "",
    })),
  };
}

/**
 * Create a draft with explicit defaults that individual scenarios may override.
 * @param field The selected inventory column.
 * @param changes Operands and operators specific to the scenario.
 * @returns A structurally complete filter condition.
 */
export function filterRule(
  field: InventoryField,
  changes: Partial<ItemFilter> = {},
): ItemFilter {
  return {
    id: "rule",
    fieldId: field.id,
    fieldType: field.field_type,
    operator: itemFilterOperators(field.field_type)[0],
    value: "",
    valueTo: "",
    optionIds: [],
    ...changes,
  };
}

/**
 * Build an item from a field-to-value record without converting the stored types.
 * @param values The values keyed by field identifier.
 * @param id The optional item identifier.
 * @returns A stored item suitable for filter composition tests.
 */
export function filterItem(
  values: Record<string, unknown>,
  id = "item",
): InventoryItem {
  return {
    id,
    inventory_id: "inventory",
    revision: 1,
    created_at: "",
    updated_at: "",
    values: Object.entries(values).map(([field_id, value]) => ({
      id: `${id}-${field_id}`,
      field_id,
      value,
      created_at: "",
      updated_at: "",
    })),
  };
}
