import { type FormEvent, useState } from "react";

import { useCreateInventoryField } from "../hooks/useInventoryFields";
import { ApiError } from "../services/api";

interface InventoryFieldCreateFormProps {
  inventoryId: string;
}

export function InventoryFieldCreateForm({
  inventoryId,
}: InventoryFieldCreateFormProps) {
  const [name, setName] = useState("");
  const createInventoryField = useCreateInventoryField();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    createInventoryField.mutate(
      {
        inventoryId,
        data: {
          name: name.trim(),
        },
      },
      {
        onSuccess: () => {
          setName("");
        },
      },
    );
  }

  return (
    <form
      className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label className="sr-only" htmlFor="inventory-field-name">
            Field name
          </label>
          <input
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            id="inventory-field-name"
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            placeholder="Field name"
            required
            value={name}
          />
        </div>

        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-400"
          disabled={createInventoryField.isPending || !name.trim()}
          type="submit"
        >
          {createInventoryField.isPending ? "Adding…" : "Add field"}
        </button>
      </div>

      {createInventoryField.error && (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {createInventoryField.error instanceof ApiError
            ? createInventoryField.error.message
            : "Unable to create inventory field."}
        </p>
      )}
    </form>
  );
}
