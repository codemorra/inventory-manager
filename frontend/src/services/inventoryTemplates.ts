import { request } from "./api";
import type { InventoryEditorResult } from "../types/inventoryEditor";
import type {
  InventoryTemplate,
  SaveInventoryTemplateInput,
  InstantiateInventoryTemplateInput,
  UpdateInventoryTemplateInput,
} from "../types/inventoryTemplate";

/**
 * Load available structure templates.
 * @returns Active templates with their saved revisions and ordered definitions.
 */
export function getInventoryTemplates(): Promise<InventoryTemplate[]> {
  return request("/inventory-templates");
}

/**
 * Read a complete template baseline for an editor or explicit conflict recovery.
 * @param id The active template identifier.
 * @returns Its current metadata, fields, and revision.
 */
export function getInventoryTemplate(id: string): Promise<InventoryTemplate> {
  return request(`/inventory-templates/${id}`);
}

/**
 * Replace the saved template only when its captured revision still matches.
 * @param id The template being edited.
 * @param data The complete local draft and its original revision.
 * @returns The updated independent blueprint.
 */
export function updateInventoryTemplate(
  id: string,
  data: UpdateInventoryTemplateInput,
): Promise<InventoryTemplate> {
  return request(`/inventory-templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

/**
 * Delete the template revision explicitly confirmed by the user.
 * @param id The template being deleted.
 * @param expectedRevision The revision displayed in the confirmation.
 * @returns Completion of the deletion request.
 */
export function deleteInventoryTemplate(
  id: string,
  expectedRevision: number,
): Promise<void> {
  return request(`/inventory-templates/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ expected_revision: expectedRevision }),
  });
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
