import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import {
  InventoryDraftContext,
  type InventoryDraftActions,
} from "../../src/components/InventoryDraftContext";
import type { InventoryField } from "../../src/types/inventoryField";

// Use synthetic saved identifiers to distinguish local edits from new draft objects.
export const field: InventoryField = {
  id: "field-1",
  inventory_id: "inventory-1",
  name: "Brand",
  field_type: "text",
  max_length: 255,
  options: [],
  position: 0,
  created_at: "",
  updated_at: "",
};
export const option = {
  id: "option-1",
  field_id: field.id,
  name: "RPG",
  position: 0,
  created_at: "",
  updated_at: "",
};

/**
 * Render a field control with local action spies rather than network mutations.
 * @param children The control under test.
 * @param overrides Optional draft state or actions for the scenario.
 * @returns The render result and action spies.
 */
export function renderDraftControl(
  children: ReactNode,
  overrides: Partial<InventoryDraftActions> = {},
) {
  const actions = {
    fields: [field],
    disabled: false,
    addField: vi.fn(),
    renameField: vi.fn(),
    removeField: vi.fn(),
    addOption: vi.fn(),
    renameOption: vi.fn(),
    removeOption: vi.fn(),
    setPendingEditor: vi.fn(),
    ...overrides,
  };
  return {
    ...render(
      <InventoryDraftContext.Provider value={actions}>
        {children}
      </InventoryDraftContext.Provider>,
    ),
    actions,
  };
}
