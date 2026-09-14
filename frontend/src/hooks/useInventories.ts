import { useQuery } from "@tanstack/react-query";

import { getInventories } from "../services/inventories";

export function useInventories() {
  return useQuery({
    queryKey: ["inventories"],
    queryFn: getInventories,
  });
}
