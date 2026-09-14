import { InventoryCard } from "../components/InventoryCard";
import { InventoryCreateForm } from "../components/InventoryCreateForm";
import { useInventories } from "../hooks/useInventories";
import { ApiError } from "../services/api";

export function InventoryOverviewPage() {
  const { data: inventories, error, isError, isPending } = useInventories();

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold">Inventories</h1>
        </header>

        <div className="mb-8">
          <InventoryCreateForm />
        </div>

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
              <li key={inventory.id}>
                <InventoryCard inventory={inventory} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
