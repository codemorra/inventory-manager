import type { InventoryFieldType } from "./inventoryField";

// Operators are independent of translated labels and validated against the field type.
export type ItemFilterOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "greaterThan"
  | "atLeast"
  | "lessThan"
  | "atMost"
  | "between"
  | "before"
  | "after"
  | "isTrue"
  | "isFalse"
  | "anyOf"
  | "noneOf"
  | "isEmpty"
  | "isNotEmpty";

// Store operands as input strings, keeping incomplete draft values editable until Apply.
export interface ItemFilter {
  id: string;
  fieldId: string;
  fieldType: InventoryFieldType;
  operator: ItemFilterOperator;
  value: string;
  valueTo: string;
  optionIds: string[];
}
