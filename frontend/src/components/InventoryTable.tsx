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
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
              <tr>
                <th
                  className="border-b border-slate-200 px-4 py-3 dark:border-slate-700"
                  scope="col"
                >
                  {t("common.fields.name")}
                </th>
                <th
                  className="border-b border-slate-200 px-4 py-3 dark:border-slate-700"
                  scope="col"
                >
                  {t("common.fields.description")}
                </th>
                <th
                  className="border-b border-slate-200 px-4 py-3 text-right dark:border-slate-700"
                  scope="col"
                >
                  {t("table.actions")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {inventories.map((inventory) => (
                <tr
                  className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  key={inventory.id}
                >
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {inventory.name}
                  </td>
                  <td className="max-w-xl px-4 py-3 text-slate-600 dark:text-slate-400">
                    {inventory.description || "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Link
                        className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                        to={`/inventories/${inventory.id}/items`}
                      >
                        {t("inventories.actions.items")}
                      </Link>
                      <Link
                        className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                        to={`/inventories/${inventory.id}/fields`}
                      >
                        {t("inventories.actions.fields")}
                      </Link>
                      <button
                        className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
                        disabled={isMutating}
                        onClick={() => startEditing(inventory)}
                        type="button"
                      >
                        {t("common.actions.edit")}
                      </button>
                      <button
                        className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-500 dark:hover:bg-red-400"
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
            className="border-t border-slate-200 px-4 py-3 text-red-700 dark:border-slate-800 dark:text-red-300"
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
        >
          <form className="space-y-4" onSubmit={handleUpdate}>
            <label
              className="block font-medium"
              htmlFor={`inventory-${editingInventory.id}-name`}
            >
              {t("common.fields.name")}
              <input
                autoFocus
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                id={`inventory-${editingInventory.id}-name`}
                maxLength={255}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </label>
            <label
              className="block font-medium"
              htmlFor={`inventory-${editingInventory.id}-description`}
            >
              {t("common.fields.description")}
              <textarea
                className="mt-1 min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                id={`inventory-${editingInventory.id}-description`}
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </label>

            {updateInventory.error && (
              <p className="text-red-700 dark:text-red-300" role="alert">
                {updateInventory.error instanceof ApiError
                  ? updateInventory.error.message
                  : t("inventories.errors.update")}
              </p>
            )}

            <div className="flex gap-3">
              <button
                className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
                disabled={isMutating || !name.trim()}
                type="submit"
              >
                {updateInventory.isPending
                  ? t("common.actions.saving")
                  : t("common.actions.saveChanges")}
              </button>
              <button
                className="rounded-md border border-slate-300 px-4 py-2 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
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
