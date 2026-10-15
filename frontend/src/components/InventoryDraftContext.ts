import { createContext, useContext, useEffect } from "react";
import type {
  CreateInventoryFieldInput,
  InventoryField,
} from "../types/inventoryField";

// Expose local draft operations without any network mutation fallback.
export interface InventoryDraftActions {
  fields: InventoryField[];
  disabled: boolean;
  addField: (data: CreateInventoryFieldInput) => void;
  updateField: (
    id: string,
    changes: { name: string; is_required: boolean; is_sortable: boolean },
  ) => void;
  removeField: (id: string) => void;
  addOption: (fieldId: string, name: string) => void;
  renameOption: (fieldId: string, id: string, name: string) => void;
  removeOption: (fieldId: string, id: string) => void;
  setPendingEditor: (id: string, active: boolean) => void;
}

export const InventoryDraftContext =
  createContext<InventoryDraftActions | null>(null);

/**
 * Access the active editor's local field operations.
 * @returns Draft actions scoped to the open editor.
 */
export function useInventoryDraft() {
  const draft = useContext(InventoryDraftContext);
  if (!draft) throw new Error("Field controls require an inventory draft.");
  return draft;
}

/**
 * Prevent saving or changing sections while a child form has unfinished input.
 * @param id The stable identifier of the child editor.
 * @param active Whether the child form has unapplied input or a pending confirmation.
 */
export function useDraftEditorLock(id: string, active: boolean) {
  const { setPendingEditor } = useInventoryDraft();
  useEffect(() => {
    setPendingEditor(id, active);
    return () => setPendingEditor(id, false);
  }, [id, active, setPendingEditor]);
}
