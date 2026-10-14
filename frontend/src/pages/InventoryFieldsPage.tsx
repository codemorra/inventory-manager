import { Navigate, useParams } from "react-router-dom";

// Preserve existing field URLs by opening field configuration in the editor.
export function InventoryFieldsPage() {
  const { inventoryId } = useParams();
  return inventoryId ? (
    <Navigate replace to={`/inventories/${inventoryId}/items?edit=fields`} />
  ) : null;
}
