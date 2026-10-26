import { request } from "./api";
import type { InventoryEditorResult } from "../types/inventoryEditor";
import type {
  InventoryTemplate,
  SaveInventoryTemplateInput,
  InstantiateInventoryTemplateInput,
} from "../types/inventoryTemplate";

/**
 * Load available structure templates.
 * @returns Active templates with their saved revisions and ordered definitions.
 */
export function getInventoryTemplates(): Promise<InventoryTemplate[]> {
  return request("/inventory-templates");
}

/**
 * Save a coherent inventory configuration as an independent template.
 * @param data The template metadata and source configuration revision.
 * @returns The saved template.
 */
export function saveInventoryTemplate(
  data: SaveInventoryTemplateInput,
): Promise<InventoryTemplate> {
  return request("/inventory-templates", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Create an empty inventory from the explicitly selected template revision.
 * @param id The selected template identifier.
 * @param data New inventory metadata and the captured template revision.
 * @returns The new inventory and its independent field configuration.
 */
export function instantiateInventoryTemplate(
  id: string,
  data: InstantiateInventoryTemplateInput,
): Promise<InventoryEditorResult> {
  return request(`/inventory-templates/${id}/inventories`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
