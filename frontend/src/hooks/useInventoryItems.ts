/** Manage inventory item queries and mutations. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createInventoryItem, deleteInventoryItem, getInventoryItems, updateInventoryItem } from "../services/inventoryItems";
import type { InventoryItemInput } from "../types/inventoryItem";

const key = (inventoryId: string) => ["inventories", inventoryId, "items"];
export function useInventoryItems(inventoryId: string) { return useQuery({ queryKey: key(inventoryId), queryFn: () => getInventoryItems(inventoryId), enabled: Boolean(inventoryId) }); }
export function useCreateInventoryItem() { const client = useQueryClient(); return useMutation({ mutationFn: ({ inventoryId, data }: { inventoryId: string; data: InventoryItemInput }) => createInventoryItem(inventoryId, data), onSuccess: (_, variables) => client.invalidateQueries({ queryKey: key(variables.inventoryId) }) }); }
export function useUpdateInventoryItem() { const client = useQueryClient(); return useMutation({ mutationFn: ({ inventoryId, itemId, data }: { inventoryId: string; itemId: string; data: InventoryItemInput }) => updateInventoryItem(inventoryId, itemId, data), onSuccess: (_, variables) => client.invalidateQueries({ queryKey: key(variables.inventoryId) }) }); }
export function useDeleteInventoryItem() { const client = useQueryClient(); return useMutation({ mutationFn: ({ inventoryId, itemId }: { inventoryId: string; itemId: string }) => deleteInventoryItem(inventoryId, itemId), onSuccess: (_, variables) => client.invalidateQueries({ queryKey: key(variables.inventoryId) }) }); }
