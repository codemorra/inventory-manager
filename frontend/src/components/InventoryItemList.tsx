/** Render active inventory items and their stored values. */
import type { InventoryItem } from "../types/inventoryItem";

export function InventoryItemList({ items }: { items: InventoryItem[] }) {
  return (
    <ul className="mt-6 space-y-3">
      {items.map((item) => (
        <li className="rounded border p-4 dark:border-slate-800" key={item.id}>
          {item.values.map((value) => (
            <p key={value.id}>{String(value.value)}</p>
          ))}
        </li>
      ))}
    </ul>
  );
}
