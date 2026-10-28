import { preferenceStore } from "../../src/preferences/store";
import type {
  ApplicationPreferences,
  ApplicationSettings,
  InventoryViewState,
} from "../../src/types/preferences";
import type { InventoryViewPreferences } from "../../src/types/inventoryView";
import type * as Api from "../../src/services/preferences";

const defaults: ApplicationPreferences = {
  language: "system",
  theme: "system",
  accent: "teal",
  attachmentWarnings: "show",
};
const initialView: InventoryViewPreferences = {
  version: 1,
  sort: null,
  hiddenFieldIds: [],
  wrapText: true,
  attachmentPreviews: false,
  columnWidths: {},
};
let settings: ApplicationSettings;
const views = new Map<string, InventoryViewState>();
export const preferenceApi: typeof Api = {
  async getApplicationSettings() {
    return structuredClone(settings);
  },
  async updateApplicationSettings(revision, preferences) {
    settings = {
      ...settings,
      revision: revision + 1,
      preferences: { ...settings.preferences, ...preferences },
    };
    return structuredClone(settings);
  },
  async getInventoryViews() {
    return structuredClone([...views.values()]);
  },
  async getInventoryView(id) {
    return structuredClone(
      views.get(id) ?? {
        inventory_id: id,
        revision: 0,
        preferences: initialView,
      },
    );
  },
  async updateInventoryView(id, revision, preferences) {
    const value = { inventory_id: id, revision: revision + 1, preferences };
    views.set(id, value);
    return structuredClone(value);
  },
};

/** Initialize an isolated backend fixture for component tests. */
export async function initializePreferences() {
  preferenceStore.dispose();
  settings = { version: 1, revision: 0, preferences: { ...defaults } };
  views.clear();
  await preferenceStore.initialize(preferenceApi);
}
/** Seed a saved view and load it through the same refresh path as external backend changes. */
export async function seedView(id: string, preferences: unknown) {
  await flushPreferences();
  const value =
    preferences && typeof preferences === "object"
      ? { ...initialView, ...preferences }
      : preferences;
  views.set(id, {
    inventory_id: id,
    revision: (views.get(id)?.revision ?? 0) + 1,
    preferences: value as InventoryViewPreferences,
  });
  await preferenceStore.refresh();
}
export async function seedPreference(
  preferences: Partial<ApplicationPreferences>,
) {
  await flushPreferences();
  settings = {
    ...settings,
    revision: settings.revision + 1,
    preferences: { ...settings.preferences, ...preferences },
  };
  await preferenceStore.refresh();
}
export function savedView(id: string) {
  const value = preferenceStore.readView(id);
  return value ? (JSON.parse(value) as InventoryViewPreferences) : null;
}
/** Drain the fixture's asynchronous save acknowledgements before changing its server state. */
export async function flushPreferences() {
  for (let i = 0; preferenceStore.getStatus().saving && i < 100; i++)
    await Promise.resolve();
}
