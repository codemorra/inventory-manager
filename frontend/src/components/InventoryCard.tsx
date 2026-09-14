import { type FormEvent, useState } from "react";

import {
  useDeleteInventory,
  useUpdateInventory,
} from "../hooks/useInventories";
import { ApiError } from "../services/api";
import type { Inventory } from "../types/inventory";

/** Define properties for an inventory card. */
interface InventoryCardProps {
  inventory: Inventory;
}

/**
 * Render inventory details and management actions.
 *
 * @param props - Inventory card properties.
 * @returns Inventory management card.
 */
export function InventoryCard({ inventory }: InventoryCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(inventory.name);
  const [description, setDescription] = useState(inventory.description ?? "");

  const updateInventory = useUpdateInventory();
  const deleteInventory = useDeleteInventory();

  const isMutating = updateInventory.isPending || deleteInventory.isPending;
  const mutationError = updateInventory.error ?? deleteInventory.error;

  function startEditing() {
    setName(inventory.name);
    setDescription(inventory.description ?? "");
    setIsEditing(true);
  }

  function cancelEditing() {
    setIsEditing(false);
  }

  function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    updateInventory.mutate(
      {
        inventoryId: inventory.id,
        data: {
          name: name.trim(),
          description: description.trim() || null,
        },
      },
      {
        onSuccess: () => {
          setIsEditing(false);
        },
      },
    );
  }

  function handleDelete() {
    if (!window.confirm(`Delete "${inventory.name}"?`)) {
      return;
    }

    deleteInventory.mutate(inventory.id);
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {isEditing ? (
        <form className="space-y-4" onSubmit={handleUpdate}>
          <div>
            <label
              className="block text-sm font-medium"
              htmlFor={`inventory-${inventory.id}-name`}
            >
              Name
            </label>
            <input
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              id={`inventory-${inventory.id}-name`}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </div>

          <div>
            <label
              className="block text-sm font-medium"
              htmlFor={`inventory-${inventory.id}-description`}
            >
              Description
            </label>
            <textarea
              className="mt-1 min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              id={`inventory-${inventory.id}-description`}
              onChange={(event) => setDescription(event.target.value)}
              value={description}
            />
          </div>

          <div className="flex gap-3">
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
              disabled={isMutating || !name.trim()}
              type="submit"
            >
              {updateInventory.isPending ? "Saving…" : "Save changes"}
            </button>

            <button
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
              disabled={isMutating}
              onClick={cancelEditing}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">{inventory.name}</h2>

              {inventory.description && (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  {inventory.description}
                </p>
              )}
            </div>

            <div className="flex shrink-0 gap-2">
              <button
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
                disabled={isMutating}
                onClick={startEditing}
                type="button"
              >
                Edit
              </button>

              <button
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-500 dark:hover:bg-red-400"
                disabled={isMutating}
                onClick={handleDelete}
                type="button"
              >
                {deleteInventory.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </>
      )}

      {mutationError && (
        <p className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">
          {mutationError instanceof ApiError
            ? mutationError.message
            : "Unable to update inventory."}
        </p>
      )}
    </article>
  );
}
