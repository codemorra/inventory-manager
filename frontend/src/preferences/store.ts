import * as api from "../services/preferences";
import { ApiError } from "../services/api";
import type {
  ApplicationPreferences,
  ApplicationSettings,
  InventoryViewState,
} from "../types/preferences";
import type { InventoryViewPreferences } from "../types/inventoryView";

type Phase = "idle" | "loading" | "ready" | "error";
interface Resource<T, P> {
  base: T;
  queue: P[];
  running: boolean;
  error: unknown;
}
export interface PreferenceStatus {
  phase: Phase;
  pending: number;
  saving: boolean;
  failed: boolean;
  conflict: boolean;
  refreshing: boolean;
  refreshFailed: boolean;
}
const defaultView: InventoryViewPreferences = {
  version: 1,
  sort: null,
  hiddenFieldIds: [],
  wrapText: true,
  attachmentPreviews: false,
  columnWidths: {},
};
const isConflict = (error: unknown) =>
  error instanceof ApiError && error.status === 409;

/**
 * Own the runtime preference cache and serialized, revision-checked backend saves.
 * @returns A store suitable for React's external-store subscription and isolated lifecycle tests.
 */
export function createPreferenceStore() {
  let phase: Phase = "idle";
  let client = api;
  let settings:
    Resource<ApplicationSettings, Partial<ApplicationPreferences>> | undefined;
  const views = new Map<
    string,
    Resource<InventoryViewState, InventoryViewPreferences>
  >();
  const listeners = new Set<() => void>();
  let epoch = 0;
  let changes = 0;
  let initialization: Promise<void> | undefined;
  let refreshing = false;
  let refreshFailed = false;
  let refreshRequested = false;
  const broadcasters = new Set<() => void>();
  const connections = new Set<() => void>();
  let snapshot: PreferenceStatus = {
    phase,
    pending: 0,
    saving: false,
    failed: false,
    conflict: false,
    refreshing,
    refreshFailed,
  };
  const resource = <T, P>(base: T): Resource<T, P> => ({
    base,
    queue: [],
    running: false,
    error: null,
  });
  function emit() {
    const resources = [...views.values(), ...(settings ? [settings] : [])];
    snapshot = {
      phase,
      pending: resources.reduce((sum, item) => sum + item.queue.length, 0),
      saving: resources.some((item) => item.running),
      failed: resources.some((item) => Boolean(item.error)),
      conflict: resources.some((item) => isConflict(item.error)),
      refreshing,
      refreshFailed,
    };
    for (const listener of listeners) listener();
  }
  const announce = () => {
    for (const broadcast of broadcasters) {
      try {
        broadcast();
      } catch {
        /* Tab invalidation is best-effort; a committed save must remain successful. */
      }
    }
  };
  function view(id: string) {
    let entry = views.get(id);
    if (!entry) {
      entry = resource({
        inventory_id: id,
        revision: 0,
        preferences: defaultView,
      });
      views.set(id, entry);
    }
    return entry;
  }
  async function refresh() {
    if (phase !== "ready" || refreshing) return;
    if (snapshot.pending || snapshot.saving) {
      refreshRequested = true;
      return;
    }
    const generation = epoch;
    const observedChanges = changes;
    refreshing = true;
    refreshFailed = false;
    emit();
    try {
      const [nextSettings, nextViews] = await Promise.all([
        client.getApplicationSettings(),
        client.getInventoryViews(),
      ]);
      if (generation !== epoch) return;
      // A user may have changed a value while the read was in flight; never overwrite optimistic choices.
      if (snapshot.pending || snapshot.saving || changes !== observedChanges) {
        refreshRequested = true;
        return;
      }
      settings = resource(nextSettings);
      views.clear();
      for (const entry of nextViews)
        views.set(entry.inventory_id, resource(entry));
    } catch {
      if (generation === epoch) refreshFailed = true;
    } finally {
      if (generation === epoch) {
        refreshing = false;
        emit();
        if (refreshRequested && !snapshot.pending && !snapshot.saving) {
          refreshRequested = false;
          void refresh();
        }
      }
    }
  }
  function refreshWhenIdle() {
    if (refreshRequested && !snapshot.pending && !snapshot.saving) {
      refreshRequested = false;
      void refresh();
    }
  }
  async function saveSettings() {
    const entry = settings;
    if (!entry || entry.running || entry.error || !entry.queue.length) return;
    const generation = epoch;
    entry.running = true;
    emit();
    try {
      while (entry.queue.length && generation === epoch) {
        try {
          const saved = await client.updateApplicationSettings(
            entry.base.revision,
            entry.queue[0]!,
          );
          if (generation !== epoch) return;
          entry.base = saved;
          entry.queue.shift();
          announce();
          emit();
        } catch (error) {
          if (generation === epoch) entry.error = error;
          break;
        }
      }
    } finally {
      if (generation === epoch) {
        entry.running = false;
        emit();
        refreshWhenIdle();
      }
    }
  }
  async function saveView(id: string) {
    const entry = view(id);
    if (entry.running || entry.error || !entry.queue.length) return;
    const generation = epoch;
    entry.running = true;
    emit();
    try {
      while (entry.queue.length && generation === epoch) {
        try {
          const saved = await client.updateInventoryView(
            id,
            entry.base.revision,
            entry.queue[0]!,
          );
          if (generation !== epoch) return;
          entry.base = saved;
          entry.queue.shift();
          announce();
          emit();
        } catch (error) {
          if (generation === epoch) entry.error = error;
          break;
        }
      }
    } finally {
      if (generation === epoch) {
        entry.running = false;
        emit();
        refreshWhenIdle();
      }
    }
  }
  const store = {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getStatus: () => snapshot,
    isReady: () => phase === "ready",
    readPreferences(): ApplicationPreferences | undefined {
      if (!settings) return undefined;
      return Object.assign({}, settings.base.preferences, ...settings.queue);
    },
    readView(id: string): string | null {
      const entry = views.get(id);
      return entry
        ? JSON.stringify(entry.queue.at(-1) ?? entry.base.preferences)
        : null;
    },
    setPreference<K extends keyof ApplicationPreferences>(
      name: K,
      value: ApplicationPreferences[K],
    ) {
      if (phase !== "ready" || !settings)
        throw new Error("Preferences are not ready.");
      changes++;
      settings.queue.push({ [name]: value });
      emit();
      void saveSettings();
    },
    setView(id: string, preferences: InventoryViewPreferences) {
      if (phase !== "ready") throw new Error("Preferences are not ready.");
      changes++;
      view(id).queue.push(preferences);
      emit();
      void saveView(id);
    },
    /** Bootstrap is retryable and idempotent; the app stays gated until preferences and views are authoritative. */
    initialize(source?: typeof api): Promise<void> {
      if (initialization) return initialization;
      if (phase === "ready") return Promise.resolve();
      if (source) client = source;
      const generation = epoch;
      phase = "loading";
      emit();
      initialization = (async () => {
        const [nextSettings, nextViews] = await Promise.all([
          client.getApplicationSettings(),
          client.getInventoryViews(),
        ]);
        if (generation !== epoch) return;
        settings = resource(nextSettings);
        views.clear();
        for (const entry of nextViews)
          views.set(entry.inventory_id, resource(entry));
        phase = "ready";
      })()
        .catch((error: unknown) => {
          if (generation === epoch) phase = "error";
          throw error;
        })
        .finally(() => {
          if (generation === epoch) {
            initialization = undefined;
            emit();
          }
        });
      return initialization;
    },
    refresh,
    retryFailed() {
      if (settings?.error && !isConflict(settings.error)) {
        settings.error = null;
        void saveSettings();
      }
      for (const [id, entry] of views)
        if (entry.error && !isConflict(entry.error)) {
          entry.error = null;
          void saveView(id);
        }
      if (refreshFailed) void refresh();
    },
    /** Explicit recovery discards failed local preference edits only after authoritative reads succeed. */
    async reloadFailed() {
      if (refreshing) return;
      const generation = epoch;
      const observedChanges = changes;
      refreshing = true;
      emit();
      try {
        if (settings?.error) {
          const saved = await client.getApplicationSettings();
          if (generation !== epoch) return;
          if (changes !== observedChanges) {
            refreshFailed = true;
            return;
          }
          settings = resource(saved);
        }
        for (const [id, entry] of views) {
          if (!entry.error) continue;
          try {
            const saved = await client.getInventoryView(id);
            if (generation !== epoch) return;
            if (changes !== observedChanges) {
              refreshFailed = true;
              return;
            }
            views.set(id, resource(saved));
          } catch (error) {
            if (generation !== epoch) return;
            if (changes !== observedChanges) {
              refreshFailed = true;
              return;
            }
            if (
              error instanceof ApiError &&
              error.status === 404 &&
              error.code === "inventory_not_found"
            )
              views.delete(id);
            else throw error;
          }
        }
        refreshFailed = false;
      } catch {
        if (generation === epoch) refreshFailed = true;
      } finally {
        if (generation === epoch) {
          refreshing = false;
          emit();
          refreshWhenIdle();
        }
      }
    },
    /** Refresh idle preferences on focus and commits from other application tabs. */
    connect() {
      const focus = () => {
        void refresh();
      };
      const beforeUnload = (event: BeforeUnloadEvent) => {
        if (phase === "ready" && snapshot.pending > 0) {
          event.preventDefault();
          event.returnValue = "";
        }
      };
      window.addEventListener("focus", focus);
      window.addEventListener("beforeunload", beforeUnload);
      let channel: BroadcastChannel | null = null;
      try {
        if (typeof BroadcastChannel !== "undefined")
          channel = new BroadcastChannel("inventory-manager-preferences");
      } catch {
        /* Privacy restrictions may block channels; focus refresh remains available. */
      }
      const broadcast = () => channel?.postMessage("changed");
      broadcasters.add(broadcast);
      if (channel)
        channel.onmessage = (event) => {
          if (event.data === "changed") void refresh();
        };
      const disconnect = () => {
        if (!connections.delete(disconnect)) return;
        window.removeEventListener("focus", focus);
        window.removeEventListener("beforeunload", beforeUnload);
        broadcasters.delete(broadcast);
        channel?.close();
      };
      connections.add(disconnect);
      return disconnect;
    },
    /** End a runtime session; delayed responses cannot repopulate a replaced data source. */
    dispose() {
      for (const disconnect of connections) disconnect();
      epoch++;
      client = api;
      initialization = undefined;
      settings = undefined;
      views.clear();
      phase = "idle";
      refreshing = false;
      refreshFailed = false;
      refreshRequested = false;
      emit();
    },
  };
  return store;
}
export const preferenceStore = createPreferenceStore();
