import type { LoaderFunctionArgs } from "react-router-dom";
import { inventoryFieldsQueryOptions } from "../hooks/useInventoryFields";
import { inventoryItemsQueryOptions } from "../hooks/useInventoryItems";
import { queryClient } from "../queryClient";

/** Keep the current route visible until the target inventory can render its table. */
export async function inventoryItemsLoader({
  params,
}: Pick<LoaderFunctionArgs, "params">) {
  const id = params.inventoryId;
  if (!id) return null;
  // Cached inventories switch immediately. The page retains its existing error handling.
  await Promise.allSettled([
    queryClient.ensureQueryData(inventoryFieldsQueryOptions(id)),
    queryClient.ensureQueryData(inventoryItemsQueryOptions(id)),
  ]);
  return null;
}
