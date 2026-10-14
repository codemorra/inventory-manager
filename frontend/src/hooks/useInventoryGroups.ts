import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createInventoryGroup,
  deleteInventoryGroup,
  getInventoryGroups,
  updateInventoryGroup,
} from "../services/inventoryGroups";

// Load persistent groups for inventory navigation.
export function useInventoryGroups() {
  return useQuery({
    queryKey: ["inventory-groups"],
    queryFn: getInventoryGroups,
  });
}

// Manage groups and refresh both group names and inventory memberships.
export function useGroupMutations() {
  const client = useQueryClient();
  // Refresh all views after a group or its membership has changed.
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["inventory-groups"] }),
      client.invalidateQueries({ queryKey: ["inventories"] }),
    ]);
  }
  const create = useMutation({
    mutationFn: (name: string) => createInventoryGroup(name),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      updateInventoryGroup(id, name),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteInventoryGroup(id),
    onSuccess: refresh,
  });
  return { create, update, remove };
}
