import { useQuery } from "@tanstack/react-query";

import { getInventoryFields } from "../services/inventoryFields";

export function useInventoryFields(inventoryId: string) {
  return useQuery({
    queryKey: ["inventories", inventoryId, "fields"],
    queryFn: () => getInventoryFields(inventoryId),
    enabled: Boolean(inventoryId),
  });
}
