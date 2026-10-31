import type { InventoryViewPreferences } from "./inventoryView";

export interface ApplicationPreferences {
  language: "system" | "de" | "en";
  theme: "system" | "light" | "dark";
  accent: "turquoise" | "cyan" | "blue" | "purple" | "orange" | "green" | "slate";
  attachmentWarnings: "show" | "hide";
}
export interface ApplicationSettings {
  version: 1;
  revision: number;
  preferences: ApplicationPreferences;
}
export interface InventoryViewState {
  inventory_id: string;
  revision: number;
  preferences: InventoryViewPreferences;
}
