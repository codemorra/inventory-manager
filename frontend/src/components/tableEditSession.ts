import { createContext, type Dispatch, type SetStateAction } from "react";

// Share the active edit lock with inventory configuration and sidebar actions.
export const TableEditSessionContext = createContext<{
  inventoryId: string | null;
  setInventoryId: Dispatch<SetStateAction<string | null>>;
}>({ inventoryId: null, setInventoryId: () => {} });
