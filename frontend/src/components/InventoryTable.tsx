import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

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
  const navigate = useNavigate();
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
                  className="cursor-pointer transition-colors hover:bg-surface-hover/60"
                  onClick={(event) => {
                    if ((event.target as Element).closest("a, button")) return;
                    void navigate(`/inventories/${inventory.id}/items`);
                  }}
                  key={inventory.id}
                >
                  <td className="px-5 py-4 font-semibold text-foreground">
                    <Link
                      className="rounded-sm transition-colors hover:text-accent-text focus-visible:outline-2 focus-visible:outline-accent"
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
                      <button
                        className="flex size-8 cursor-pointer items-center justify-center rounded-sm border border-shell transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={t("common.actions.edit")}
                        title={t("common.actions.edit")}
                        disabled={isMutating}
                        onClick={() => startEditing(inventory)}
                        type="button"
                      >
                        <svg
                          aria-hidden="true"
                          className="size-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z" />
                        </svg>
                      </button>
                      <button
                        className="flex size-8 cursor-pointer items-center justify-center rounded-sm bg-danger-soft text-danger transition enabled:hover:bg-danger/25 focus-visible:outline-2 focus-visible:outline-danger disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={t(
                          deleteInventory.isPending
                            ? "common.actions.deleting"
                            : "common.actions.delete",
                        )}
                        title={t("common.actions.delete")}
                        aria-busy={deleteInventory.isPending || undefined}
                        disabled={isMutating}
                        onClick={() => handleDelete(inventory)}
                        type="button"
                      >
                        <svg
                          aria-hidden="true"
                          className="size-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" />
                        </svg>
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
