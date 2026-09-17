import { type FormEvent, useState } from "react";

import {
  useCreateInventoryFieldOption,
  useDeleteInventoryFieldOption,
  useUpdateInventoryFieldOption,
} from "../hooks/useInventoryFields";
import { ApiError } from "../services/api";
import type { InventoryFieldOption } from "../types/inventoryField";

/** Define properties for selectable inventory field options. */
interface InventoryFieldOptionsProps {
  inventoryId: string;
  fieldId: string;
  options: InventoryFieldOption[];
}

/** Render selectable field options and their management controls. */
export function InventoryFieldOptions({
  inventoryId,
  fieldId,
  options,
}: InventoryFieldOptionsProps) {
  const [newOptionName, setNewOptionName] = useState("");
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [editingOptionName, setEditingOptionName] = useState("");
  const createOption = useCreateInventoryFieldOption();
  const updateOption = useUpdateInventoryFieldOption();
  const deleteOption = useDeleteInventoryFieldOption();
  const isMutating =
    createOption.isPending || updateOption.isPending || deleteOption.isPending;
  const mutationError =
    createOption.error ?? updateOption.error ?? deleteOption.error;

  function addOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    createOption.mutate(
      { inventoryId, fieldId, data: { name: newOptionName.trim() } },
      { onSuccess: () => setNewOptionName("") },
    );
  }

  function saveOption(event: FormEvent<HTMLFormElement>, optionId: string) {
    event.preventDefault();
    updateOption.mutate(
      {
        inventoryId,
        fieldId,
        optionId,
        data: { name: editingOptionName.trim() },
      },
      { onSuccess: () => setEditingOptionId(null) },
    );
  }

  function removeOption(option: InventoryFieldOption) {
    if (!window.confirm(`Delete "${option.name}"?`)) return;
    deleteOption.mutate({ inventoryId, fieldId, optionId: option.id });
  }

  return (
    <section className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
      <h3 className="text-sm font-medium">Options</h3>
      <ul className="mt-2 space-y-2">
        {options.map((option) => (
          <li key={option.id}>
            {editingOptionId === option.id ? (
              <form
                className="flex gap-2"
                onSubmit={(event) => saveOption(event, option.id)}
              >
                <input
                  aria-label="Option name"
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  maxLength={255}
                  onChange={(event) => setEditingOptionName(event.target.value)}
                  required
                  value={editingOptionName}
                />
                <button
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-60 dark:bg-blue-500"
                  disabled={isMutating || !editingOptionName.trim()}
                  type="submit"
                >
                  Save
                </button>
                <button
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"
                  disabled={isMutating}
                  onClick={() => setEditingOptionId(null)}
                  type="button"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">{option.name}</span>
                <div className="flex gap-2">
                  <button
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm dark:border-slate-700"
                    disabled={isMutating}
                    onClick={() => {
                      setEditingOptionId(option.id);
                      setEditingOptionName(option.name);
                    }}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="rounded-md text-sm text-red-700 disabled:opacity-60 dark:text-red-300"
                    disabled={isMutating}
                    onClick={() => removeOption(option)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={addOption}>
        <input
          aria-label="New option name"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          maxLength={255}
          onChange={(event) => setNewOptionName(event.target.value)}
          placeholder="New option"
          required
          value={newOptionName}
        />
        <button
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium disabled:opacity-60 dark:border-slate-700"
          disabled={isMutating || !newOptionName.trim()}
          type="submit"
        >
          Add
        </button>
      </form>
      {mutationError && (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300" role="alert">
          {mutationError instanceof ApiError
            ? mutationError.message
            : "Unable to manage inventory field options."}
        </p>
      )}
    </section>
  );
}
