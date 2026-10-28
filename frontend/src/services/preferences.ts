import { request } from "./api";
import type {
  ApplicationPreferences,
  ApplicationSettings,
  InventoryViewState,
} from "../types/preferences";
import type { InventoryViewPreferences } from "../types/inventoryView";
const viewPath = (id: string) =>
  `/inventories/${encodeURIComponent(id)}/view-preferences`;

/** Load the file-backed application preferences, including their optimistic-concurrency revision. */
export function getApplicationSettings(): Promise<ApplicationSettings> {
  return request("/application-settings");
}
/** Merge explicitly chosen preference keys at the captured revision. */
export function updateApplicationSettings(
  revision: number,
  preferences: Partial<ApplicationPreferences>,
): Promise<ApplicationSettings> {
  return request("/application-settings", {
    method: "PATCH",
    body: JSON.stringify({ expected_revision: revision, preferences }),
  });
}
/** Load persisted views for active inventories before rendering editable table controls. */
export function getInventoryViews(): Promise<InventoryViewState[]> {
  return request("/inventory-view-preferences");
}
/** Read authoritative view state for explicit conflict recovery. */
export function getInventoryView(id: string): Promise<InventoryViewState> {
  return request(viewPath(id));
}
/** Save manual bases and other presentation choices without storing runtime width surplus. */
export function updateInventoryView(
  id: string,
  revision: number,
  preferences: InventoryViewPreferences,
): Promise<InventoryViewState> {
  return request(viewPath(id), {
    method: "PUT",
    body: JSON.stringify({ expected_revision: revision, preferences }),
  });
}
