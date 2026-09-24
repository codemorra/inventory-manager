import { type FormEvent, useState } from "react";

import { useCreateInventory } from "../hooks/useInventories";
import { ApiError } from "../services/api";
import { Modal } from "./Modal";

/** Render a modal form for creating a new inventory. */
export function InventoryCreateForm() {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createInventory = useCreateInventory();

  function closeModal() {
    if (!createInventory.isPending) {
      setIsOpen(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    createInventory.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
      },
      {
        onSuccess: () => {
          setName("");
          setDescription("");
          setIsOpen(false);
        },
      },
    );
  }

  return (
    <>
      <button
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        New inventory
      </button>

      {isOpen && (
        <Modal onClose={closeModal} title="Create inventory">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div>
              <label
                className="block text-sm font-medium"
                htmlFor="inventory-name"
              >
                Name
              </label>
              <input
                autoFocus
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                id="inventory-name"
                maxLength={255}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>

            <div>
              <label
                className="block text-sm font-medium"
                htmlFor="inventory-description"
              >
                Description
              </label>
              <textarea
                className="mt-1 min-h-24 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                id="inventory-description"
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </div>

            {createInventory.isError && (
              <p
                className="text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {createInventory.error instanceof ApiError
                  ? createInventory.error.message
                  : "Unable to create inventory."}
              </p>
            )}

            <div className="flex gap-3">
              <button
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
                disabled={createInventory.isPending || !name.trim()}
                type="submit"
              >
                {createInventory.isPending ? "Creating…" : "Create inventory"}
              </button>
              <button
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800"
                disabled={createInventory.isPending}
                onClick={closeModal}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
