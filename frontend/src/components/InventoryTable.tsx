import { type SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import {
  useDeleteInventory,
  useUpdateInventory,
} from "../hooks/useInventories";
import { ApiError } from "../services/api";
import type { Inventory } from "../types/inventory";
import { Modal } from "./Modal";

// Define properties for the inventory table.
interface InventoryTableProps {
  inventories: Inventory[];
}

/**
 * Render inventories with navigation and management actions.
 * @param inventories The list of inventories to render.
 */
export function InventoryTable({ inventories }: InventoryTableProps) {
  const { t } = useTranslation();
  const [editingInventoryId, setEditingInventoryId] = useState<string | null>(
    null,
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const updateInventory = useUpdateInventory();
  const deleteInventory = useDeleteInventory();
  const isMutating = updateInventory.isPending || deleteInventory.isPending;
  const editingInventory = inventories.find(
    (inventory) => inventory.id === editingInventoryId,
  );

  /**
   * Start editing the specified inventory.
   * @param inventory The inventory to edit.
   */
  function startEditing(inventory: Inventory) {
    setEditingInventoryId(inventory.id);
    setName(inventory.name);
    setDescription(inventory.description ?? "");
  }

  // Cancel editing the current inventory.
  function cancelEditing() {
    setEditingInventoryId(null);
    setName("");
    setDescription("");
  }

  /**
   * Handle the submission of the edit form for the current inventory.
   * @param event The form submission event.
   */
  function handleUpdate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingInventory) {
      return;
    }

    updateInventory.mutate(
      {
        inventoryId: editingInventory.id,
        data: {
          name: name.trim(),
          description: description.trim() || null,
        },
      },
      { onSuccess: cancelEditing },
    );
  }

  /**
   * Handle the deletion of an inventory.
   * @param inventory The inventory to delete.
   */
  function handleDelete(inventory: Inventory) {
    if (
      !window.confirm(t("inventories.confirmDelete", { name: inventory.name }))
    ) {
      return;
    }

    deleteInventory.mutate(inventory.id);
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
                      className="transition-colors hover:text-accent"
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
                        className="rounded-lg bg-accent-soft px-3 py-2 font-medium text-accent transition hover:bg-accent/15"
                        to={`/inventories/${inventory.id}/items`}
                      >
                        {t("inventories.actions.items")}
                      </Link>
                      <Link
                        className="rounded-lg border border-shell px-3 py-2 font-medium transition hover:bg-surface-hover"
                        to={`/inventories/${inventory.id}/fields`}
                      >
                        {t("inventories.actions.fields")}
                      </Link>
                      <button
                        className="rounded-lg border border-shell px-3 py-2 font-medium transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isMutating}
                        onClick={() => startEditing(inventory)}
                        type="button"
                      >
                        {t("common.actions.edit")}
                      </button>
                      <button
                        className="rounded-lg bg-danger-soft px-3 py-2 font-medium text-danger transition hover:bg-danger/15 disabled:cursor-not-allowed disabled:opacity-50"
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

        {deleteInventory.error && (
          <p
            className="border-t border-shell bg-danger-soft px-5 py-3 text-danger"
            role="alert"
          >
            {deleteInventory.error instanceof ApiError
              ? deleteInventory.error.message
              : t("inventories.errors.delete")}
          </p>
        )}
      </div>

      {editingInventory && (
        <Modal
          onClose={() => {
            if (!isMutating) cancelEditing();
          }}
          title={t("inventories.titles.edit")}
          size="medium"
        >
          <form className="space-y-4" onSubmit={handleUpdate}>
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor={`inventory-${editingInventory.id}-name`}
            >
              {t("common.fields.name")}
              <input
                autoFocus
                className="mt-1.5 w-full rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                id={`inventory-${editingInventory.id}-name`}
                maxLength={255}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor={`inventory-${editingInventory.id}-description`}
            >
              {t("common.fields.description")}
              <textarea
                className="mt-1.5 min-h-28 w-full resize-y rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                id={`inventory-${editingInventory.id}-description`}
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </label>

            {updateInventory.error && (
              <p
                className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
                role="alert"
              >
                {updateInventory.error instanceof ApiError
                  ? updateInventory.error.message
                  : t("inventories.errors.update")}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-3 pt-1">
              <button
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isMutating || !name.trim()}
                type="submit"
              >
                {updateInventory.isPending
                  ? t("common.actions.saving")
                  : t("common.actions.saveChanges")}
              </button>
              <button
                className="rounded-lg border border-shell px-4 py-2.5 text-sm font-semibold transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isMutating}
                onClick={cancelEditing}
                type="button"
              >
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
