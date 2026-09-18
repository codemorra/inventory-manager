/** Render a dynamic form that creates inventory items. */

import { useState } from "react";
import { useCreateInventoryItem } from "../hooks/useInventoryItems";
import type { InventoryField } from "../types/inventoryField";

export function InventoryItemCreateForm({ inventoryId, fields }: { inventoryId: string; fields: InventoryField[] }) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const createItem = useCreateInventoryItem();
  return <form onSubmit={(event) => { event.preventDefault(); createItem.mutate({ inventoryId, data: { values: fields.map((field) => ({ field_id: field.id, value: values[field.id] ?? "" })) } }); }}><h2 className="text-xl font-semibold">Add item</h2>{fields.map((field) => <label className="mt-3 block" key={field.id}>{field.name}<input className="mt-1 block w-full rounded border p-2 dark:bg-slate-950" maxLength={field.max_length ?? undefined} onChange={(event) => setValues({ ...values, [field.id]: field.field_type === "number" ? Number(event.target.value) : event.target.value })} type={field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : field.field_type === "time" ? "time" : "text"} /></label>)}<button className="mt-4 rounded bg-blue-600 px-4 py-2 text-white" type="submit">Add item</button></form>;
}
