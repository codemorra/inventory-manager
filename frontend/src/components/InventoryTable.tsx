import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { useDeleteInventory } from "../hooks/useInventories";
import { ApiError } from "../services/api";
import type { Inventory } from "../types/inventory";
import { InventoryEditDialog } from "./InventoryEditDialog";

// Define properties for the inventory table.
interface InventoryTableProps {
  inventories: Inventory[];
}

/**
 * Render inventories with navigation and management actions.
 * @param inventories The list of inventories to render.
 * @returns The inventory table and its management dialogs.
 */
export function InventoryTable({ inventories }: InventoryTableProps) {
  const [deletingTarget, setDeletingTarget] = useState<Inventory | null>(null);
  const { t } = useTranslation();
  const [editingInventoryId, setEditingInventoryId] = useState<string | null>(
    null,
  );
  const deleteInventory = useDeleteInventory();
  const isMutating = deleteInventory.isPending;
  const editingInventory = inventories.find(
    (inventory) => inventory.id === editingInventoryId,
  );

  /**
   * Start editing the specified inventory.
   * @param inventory The inventory to edit.
   */
  function startEditing(inventory: Inventory) {
    setEditingInventoryId(inventory.id);
  }

  // Cancel editing the current inventory.
  function cancelEditing() {
    setEditingInventoryId(null);
  }

  /**
   * Ask for confirmation before deleting the selected inventory.
   * @param inventory The inventory selected for deletion.
   */
  function handleDelete(inventory: Inventory) {
    deleteInventory.reset();
    setDeletingTarget(inventory);
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-shell bg-surface shadow-soft">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-surface-muted text-xs font-semibold uppercase tracking-wider text-muted">
              <tr>
                <th className="border-b border-shell px-5 py-3.5" scope="col">
                  {t("common.fields.name")}
                </th>
                <th className="border-b border-shell px-5 py-3.5" scope="col">
                  {t("common.fields.description")}
                </th>
                <th
                  className="border-b border-shell px-5 py-3.5 text-right"
                  scope="col"
                >
                  {t("table.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-shell">
              {inventories.map((inventory) => (
                <tr
                  className="transition-colors hover:bg-surface-hover/60"
                  key={inventory.id}
                >
                  <td className="px-5 py-4 font-semibold text-foreground">
                    <Link
                      className="transition-colors hover:text-accent-text"
                      to={`/inventories/${inventory.id}/items`}
                    >
                      {inventory.name}
                    </Link>
                  </td>
                  <td className="max-w-xl px-5 py-4 text-muted">
                    {inventory.description || "—"}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        className="rounded-lg bg-accent-soft px-3 py-2 font-medium text-accent-text transition hover:bg-control-hover"
                        to={`/inventories/${inventory.id}/items`}
                      >
                        {t("inventories.actions.items")}
                      </Link>
                      <button
                        className="rounded-lg border border-shell px-3 py-2 font-medium transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isMutating}
                        onClick={() => startEditing(inventory)}
                        type="button"
                      >
                        {t("common.actions.edit")}
                      </button>
                      <button
                        className="rounded-lg bg-danger-soft px-3 py-2 font-medium text-danger transition enabled:hover:bg-danger/25 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isMutating}
                        onClick={() => handleDelete(inventory)}
                        type="button"
                      >
                        {deleteInventory.isPending
                          ? t("common.actions.deleting")
                          : t("common.actions.delete")}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingInventory && (
        <InventoryEditDialog
          key={editingInventory.id}
          inventory={editingInventory}
          onClose={cancelEditing}
        />
      )}
      {deletingTarget && (
        <DeleteConfirmationDialog
          title={t("contextMenu.deleteInventory")}
          message={t("inventories.confirmDelete", {
            name: deletingTarget.name,
          })}
          isPending={deleteInventory.isPending}
          error={
            deleteInventory.error
              ? deleteInventory.error instanceof ApiError
                ? deleteInventory.error.message
                : t("inventories.errors.delete")
              : null
          }
          onClose={() => setDeletingTarget(null)}
          onConfirm={() =>
            deleteInventory.mutate(deletingTarget.id, {
              onSuccess: () => setDeletingTarget(null),
            })
          }
        />
      )}
    </>
  );
}
