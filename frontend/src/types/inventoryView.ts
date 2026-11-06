// Define the active column and direction of a table sort.
export interface ItemSort {
  fieldId: string;
  direction: "ascending" | "descending";
}

// Store presentation preferences separately from inventory configuration and item data.
export interface InventoryViewPreferences {
  version: 1;
  sort: ItemSort | null;
  hiddenFieldIds: string[];
  wrapText: boolean;
  attachmentPreviews: boolean;
  // Only manual base widths; a missing field ID is the sole definition of Auto.
  columnWidths: Record<string, number>;
}
