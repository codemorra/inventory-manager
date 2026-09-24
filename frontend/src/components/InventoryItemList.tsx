import type {
  InventoryField,
  InventoryFieldOption,
} from "../types/inventoryField";
import type { InventoryItem, InventoryItemValue } from "../types/inventoryItem";

/** Define properties for the inventory item table. */
interface InventoryItemListProps {
  fields: InventoryField[];
  items: InventoryItem[];
}

/** Return an option label for a stored option identifier. */
function getOptionLabel(
  options: InventoryFieldOption[],
  optionId: string,
): string {
  return options.find((option) => option.id === optionId)?.name ?? optionId;
}

/** Format a stored value for display in the inventory table. */
function formatValue(
  field: InventoryField,
  itemValue: InventoryItemValue | undefined,
): string {
  const value = itemValue?.value;

  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (field.field_type === "boolean" && typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (field.field_type === "select" && typeof value === "string") {
    return getOptionLabel(field.options, value);
  }

  if (field.field_type === "multiselect" && Array.isArray(value)) {
    return value
      .filter((optionId): optionId is string => typeof optionId === "string")
      .map((optionId) => getOptionLabel(field.options, optionId))
      .join(", ");
  }

  return String(value);
}

/** Render active inventory items in a field-based table. */
export function InventoryItemList({ fields, items }: InventoryItemListProps) {
  return (
    <div className="mt-8 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead className="bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
            <tr>
              {fields.map((field) => (
                <th
                  className="whitespace-nowrap border-b border-slate-200 px-4 py-3 dark:border-slate-700"
                  key={field.id}
                  scope="col"
                >
                  {field.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {items.map((item) => {
              const valuesByField = new Map(
                item.values.map((value) => [value.field_id, value]),
              );

              return (
                <tr
                  className="transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  key={item.id}
                >
                  {fields.map((field) => (
                    <td
                      className="max-w-80 px-4 py-3 align-top text-slate-700 dark:text-slate-200"
                      key={field.id}
                    >
                      <span className="line-clamp-3">
                        {formatValue(field, valuesByField.get(field.id))}
                      </span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
