import { ApiError } from "../services/api";
import { useInventories } from "../hooks/useInventories";

export function InventoryOverviewPage() {
  const { data: inventories, error, isError, isPending } = useInventories();

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold">Inventories</h1>
        </header>

        {isPending && (
          <p className="text-slate-600 dark:text-slate-400" role="status">
            Loading inventories…
          </p>
        )}

        {isError && (
          <p
            className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            role="alert"
          >
            {error instanceof ApiError
              ? error.message
              : "Unable to load inventories."}
          </p>
        )}

        {!isPending && !isError && inventories?.length === 0 && (
          <p className="text-slate-600 dark:text-slate-400">
            No inventories yet.
          </p>
        )}

        {!isPending && !isError && inventories && inventories.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2">
            {inventories.map((inventory) => (
              <li
                key={inventory.id}
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <h2 className="text-lg font-medium">{inventory.name}</h2>

                {inventory.description && (
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    {inventory.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
