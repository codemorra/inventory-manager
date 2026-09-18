/** Render the inventory item overview and creation interface. */
import { Link, useParams } from "react-router-dom";

import { useInventoryItems } from "../hooks/useInventoryItems";
import { useInventoryFields } from "../hooks/useInventoryFields";
import { InventoryItemCreateForm } from "../components/InventoryItemCreateForm";
import { InventoryItemList } from "../components/InventoryItemList";

export function InventoryItemsPage() {
  const { inventoryId } = useParams();
  const { data: items, isPending } = useInventoryItems(inventoryId ?? "");
  const { data: fields } = useInventoryFields(inventoryId ?? "");
  if (!inventoryId) return null;
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto max-w-5xl">
        <Link className="text-sm text-blue-700 dark:text-blue-400" to="/">
          ← Inventories
        </Link>
        <h1 className="mt-4 text-3xl font-semibold">Inventory items</h1>
        {fields && (
          <InventoryItemCreateForm fields={fields} inventoryId={inventoryId} />
        )}
        {isPending ? (
          <p className="mt-6" role="status">
            Loading items…
          </p>
        ) : items?.length ? (
          <InventoryItemList items={items} />
        ) : (
          <p className="mt-6 text-slate-600 dark:text-slate-400">
            No items yet.
          </p>
        )}
      </div>
    </main>
  );
}
