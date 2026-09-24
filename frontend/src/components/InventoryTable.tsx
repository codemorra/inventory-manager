import { Fragment, type FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import {
  useDeleteInventory,
  useUpdateInventory,
} from "../hooks/useInventories";
import { ApiError } from "../services/api";
import type { Inventory } from "../types/inventory";

/** Define properties for the inventory table. */
interface InventoryTableProps {
  inventories: Inventory[];
}

/** Render inventories with navigation and management actions. */
export function InventoryTable({ inventories }: InventoryTableProps) {
  const [editingInventoryId, setEditingInventoryId] = useState<string | null>(
    null,
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const updateInventory = useUpdateInventory();
  const deleteInventory = useDeleteInventory();
  const isMutating = updateInventory.isPending || deleteInventory.isPending;
  const mutationError = updateInventory.error ?? deleteInventory.error;

  function startEditing(inventory: Inventory) {
    setEditingInventoryId(inventory.id);
    setName(inventory.name);
    setDescription(inventory.description ?? "");
  }

  function cancelEditing() {
    setEditingInventoryId(null);
    setName("");
    setDescription("");
  }

  function handleUpdate(
    event: FormEvent<HTMLFormElement>,
    inventory: Inventory,
  ) {
    event.preventDefault();

    updateInventory.mutate(
      {
        inventoryId: inventory.id,
        data: {
          name: name.trim(),
          description: description.trim() || null,
        },
      },
      { onSuccess: cancelEditing },
    );
  }

  function handleDelete(inventory: Inventory) {
    if (!window.confirm(`Delete "${inventory.name}"?`)) {
      return;
    }

    deleteInventory.mutate(inventory.id);
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
            <tr>
              <th
                className="border-b border-slate-200 px-4 py-3 dark:border-slate-700"
                scope="col"
              >
                Name
              </th>
              <th
                className="border-b border-slate-200 px-4 py-3 dark:border-slate-700"
                scope="col"
              >
                Description
              </th>
              <th
                className="border-b border-slate-200 px-4 py-3 text-right dark:border-slate-700"
                scope="col"
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {inventories.map((inventory) => {
              const isEditing = editingInventoryId === inventory.id;

              return (
                <Fragment key={inventory.id}>
                  <tr className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50">
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
                          Items
                        </Link>
                        <Link
                          className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                          to={`/inventories/${inventory.id}/fields`}
                        >
                          Fields
                        </Link>
                        <button
                          className="rounded-md border border-slate-300 px-3 py-1.5 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
                          disabled={isMutating}
                          onClick={() => startEditing(inventory)}
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-500 dark:hover:bg-red-400"
                          disabled={isMutating}
                          onClick={() => handleDelete(inventory)}
                          type="button"
                        >
                          {deleteInventory.isPending ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>

                  {isEditing && (
                    <tr>
                      <td
                        className="bg-slate-50 p-4 dark:bg-slate-950/50"
                        colSpan={3}
                      >
                        <form
                          className="grid gap-4 md:grid-cols-2"
                          onSubmit={(event) => handleUpdate(event, inventory)}
                        >
                          <label
                            className="block font-medium"
                            htmlFor={`inventory-${inventory.id}-name`}
                          >
                            Name
                            <input
                              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                              id={`inventory-${inventory.id}-name`}
                              maxLength={255}
                              onChange={(event) => setName(event.target.value)}
                              required
                              value={name}
                            />
                          </label>
                          <label
                            className="block font-medium"
                            htmlFor={`inventory-${inventory.id}-description`}
                          >
                            Description
                            <textarea
                              className="mt-1 min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                              id={`inventory-${inventory.id}-description`}
                              onChange={(event) =>
                                setDescription(event.target.value)
                              }
                              value={description}
                            />
                          </label>
                          <div className="flex gap-3 md:col-span-2">
                            <button
                              className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
                              disabled={isMutating || !name.trim()}
                              type="submit"
                            >
                              {updateInventory.isPending
                                ? "Saving…"
                                : "Save changes"}
                            </button>
                            <button
                              className="rounded-md border border-slate-300 px-4 py-2 font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
                              disabled={isMutating}
                              onClick={cancelEditing}
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {mutationError && (
        <p
          className="border-t border-slate-200 px-4 py-3 text-red-700 dark:border-slate-800 dark:text-red-300"
          role="alert"
        >
          {mutationError instanceof ApiError
            ? mutationError.message
            : "Unable to update inventory."}
        </p>
      )}
    </div>
  );
}
