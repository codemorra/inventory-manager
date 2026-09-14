import { type FormEvent, useState } from "react";

import { useCreateInventory } from "../hooks/useInventories";
import { ApiError } from "../services/api";

export function InventoryCreateForm() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createInventory = useCreateInventory();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    createInventory.mutate(
      {
        name,
        description: description.trim() || null,
      },
      {
        onSuccess: () => {
          setName("");
          setDescription("");
        },
      },
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-lg font-medium">Create inventory</h2>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="block text-sm font-medium" htmlFor="inventory-name">
            Name
          </label>
          <input
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
          <p className="text-sm text-red-700 dark:text-red-300" role="alert">
            {createInventory.error instanceof ApiError
              ? createInventory.error.message
              : "Unable to create inventory."}
          </p>
        )}

        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
          disabled={createInventory.isPending}
          type="submit"
        >
          {createInventory.isPending ? "Creating…" : "Create inventory"}
        </button>
      </form>
    </section>
  );
}
