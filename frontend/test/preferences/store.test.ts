import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createPreferenceStore } from "../../src/preferences/store";
import * as api from "../../src/services/preferences";
import { ApiError } from "../../src/services/api";
import type {
  ApplicationSettings,
  InventoryViewState,
} from "../../src/types/preferences";
import { deferred } from "../helpers/inventoryArchives";

vi.mock("../../src/services/preferences", () => ({
  getApplicationSettings: vi.fn(),
  updateApplicationSettings: vi.fn(),
  getInventoryViews: vi.fn(),
  getInventoryView: vi.fn(),
  updateInventoryView: vi.fn(),
}));
const original: ApplicationSettings = {
  version: 1,
  revision: 0,
  preferences: {
    language: "system",
    theme: "system",
    accent: "brand",
    attachmentWarnings: "show",
  },
};
const view: InventoryViewState = {
  inventory_id: "inventory",
  revision: 1,
  preferences: {
    version: 1,
    sort: null,
    hiddenFieldIds: [],
    wrapText: true,
    attachmentPreviews: false,
    columnWidths: { first: 120 },
  },
};
let store: ReturnType<typeof createPreferenceStore>;
beforeEach(() => {
  store = createPreferenceStore();
  vi.mocked(api.getApplicationSettings).mockResolvedValue(
    structuredClone(original),
  );
  vi.mocked(api.getInventoryViews).mockResolvedValue([]);
});
afterEach(() => {
  store.dispose();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const settled = async () => {
  await vi.waitFor(() => expect(store.getStatus().saving).toBe(false));
};

// Blocked localStorage does not prevent loading file/database preferences or create a durable browser mirror.
test("loads without browser storage and never writes it after bootstrap", async () => {
  const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  const write = vi.spyOn(Storage.prototype, "setItem");
  await store.initialize(api);
  vi.mocked(api.updateApplicationSettings).mockResolvedValue({
    ...original,
    revision: 1,
    preferences: { ...original.preferences, theme: "dark" },
  });
  store.setPreference("theme", "dark");
  await settled();
  expect(write).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(store.readPreferences()?.theme).toBe("dark");
});

// Queued settings writes use the latest acknowledged revision while all optimistic choices remain visible.
test("serializes preference edits and preserves later optimistic choices during earlier acknowledgements", async () => {
  await store.initialize(api);
  const first = deferred<ApplicationSettings>();
  vi.mocked(api.updateApplicationSettings)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({
      ...original,
      revision: 2,
      preferences: { ...original.preferences, theme: "dark", accent: "blue" },
    });
  store.setPreference("theme", "dark");
  store.setPreference("accent", "blue");
  expect(store.readPreferences()).toMatchObject({
    theme: "dark",
    accent: "blue",
  });
  expect(api.updateApplicationSettings).toHaveBeenCalledOnce();
  first.resolve({
    ...original,
    revision: 1,
    preferences: { ...original.preferences, theme: "dark" },
  });
  await settled();
  expect(api.updateApplicationSettings).toHaveBeenNthCalledWith(2, 1, {
    accent: "blue",
  });
  expect(store.readPreferences()?.accent).toBe("blue");
  expect(store.getStatus().pending).toBe(0);
});

// Inventory bases remain per-column: automatic width is absent, and response timing never overwrites newer edits.
test("persists manual bases and Auto independently per inventory in revision order", async () => {
  vi.mocked(api.getInventoryViews).mockResolvedValue([view]);
  await store.initialize(api);
  const first = deferred<InventoryViewState>();
  vi.mocked(api.updateInventoryView)
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({
      ...view,
      revision: 3,
      preferences: { ...view.preferences, columnWidths: {} },
    });
  store.setView("inventory", {
    ...view.preferences,
    columnWidths: { first: 200 },
  });
  store.setView("inventory", { ...view.preferences, columnWidths: {} });
  expect(JSON.parse(store.readView("inventory")!).columnWidths).toEqual({});
  expect(store.readView("other")).toBeNull();
  first.resolve({
    ...view,
    revision: 2,
    preferences: { ...view.preferences, columnWidths: { first: 200 } },
  });
  await settled();
  expect(api.updateInventoryView).toHaveBeenNthCalledWith(2, "inventory", 2, {
    ...view.preferences,
    columnWidths: {},
  });
  expect(store.getStatus().pending).toBe(0);
});

// Saving errors preserve local choices and require explicit retry; unrelated inventory/application queues remain independent.
test("preserves failed preferences and retries only after an explicit user action", async () => {
  await store.initialize(api);
  vi.mocked(api.updateApplicationSettings)
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce({
      ...original,
      revision: 1,
      preferences: { ...original.preferences, theme: "dark" },
    });
  store.setPreference("theme", "dark");
  await settled();
  expect(store.getStatus()).toMatchObject({
    failed: true,
    pending: 1,
    conflict: false,
  });
  expect(store.readPreferences()?.theme).toBe("dark");
  expect(api.updateApplicationSettings).toHaveBeenCalledOnce();
  vi.mocked(api.updateInventoryView).mockResolvedValue({
    ...view,
    inventory_id: "other",
  });
  store.setView("other", view.preferences);
  await settled();
  expect(api.updateInventoryView).toHaveBeenCalledOnce();
  expect(api.updateApplicationSettings).toHaveBeenCalledOnce();
  store.retryFailed();
  await settled();
  expect(api.updateApplicationSettings).toHaveBeenCalledTimes(2);
  expect(store.getStatus().failed).toBe(false);
});

// Stale revisions never trigger an automatic overwrite of preferences saved by another window.
test("keeps conflicts local until explicit reload discards the failed edits", async () => {
  await store.initialize(api);
  vi.mocked(api.updateApplicationSettings).mockRejectedValue(
    new ApiError(409, "Stale", "application_settings_conflict"),
  );
  store.setPreference("theme", "dark");
  await settled();
  store.retryFailed();
  expect(api.updateApplicationSettings).toHaveBeenCalledOnce();
  expect(store.getStatus().conflict).toBe(true);
  vi.mocked(api.getApplicationSettings).mockResolvedValue({
    ...original,
    revision: 4,
    preferences: { ...original.preferences, theme: "light" },
  });
  await store.reloadFailed();
  expect(store.readPreferences()?.theme).toBe("light");
  expect(store.getStatus()).toMatchObject({ pending: 0, failed: false });
});

// A deleted destination can be explicitly discarded after a failed view save, rather than blocking all future preferences.
test("recovers deleted-inventory view failures without changing other stored views", async () => {
  vi.mocked(api.getInventoryViews).mockResolvedValue([view]);
  await store.initialize(api);
  vi.mocked(api.updateInventoryView).mockRejectedValue(
    new ApiError(404, "Missing", "inventory_not_found"),
  );
  store.setView("gone", view.preferences);
  await settled();
  vi.mocked(api.getInventoryView).mockRejectedValue(
    new ApiError(404, "Missing", "inventory_not_found"),
  );
  await store.reloadFailed();
  expect(store.readView("gone")).toBeNull();
  expect(JSON.parse(store.readView("inventory")!).columnWidths).toEqual({
    first: 120,
  });
});

// An in-flight focus refresh must not overwrite an edit even if that edit is acknowledged before the read returns.
test("fences delayed refreshes against newer completed preference saves", async () => {
  await store.initialize(api);
  const stale = deferred<ApplicationSettings>();
  vi.mocked(api.getApplicationSettings)
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValue({
      ...original,
      revision: 1,
      preferences: { ...original.preferences, theme: "dark" },
    });
  const reading = store.refresh();
  vi.mocked(api.updateApplicationSettings).mockResolvedValue({
    ...original,
    revision: 1,
    preferences: { ...original.preferences, theme: "dark" },
  });
  store.setPreference("theme", "dark");
  await settled();
  stale.resolve(original);
  await reading;
  await vi.waitFor(() => expect(store.getStatus().refreshing).toBe(false));
  expect(store.readPreferences()?.theme).toBe("dark");
});

// Reload is an explicit discard action, but must still preserve changes made after that action began.
test("does not discard preference edits made during an explicit recovery read", async () => {
  await store.initialize(api);
  vi.mocked(api.updateApplicationSettings).mockRejectedValue(
    new ApiError(409, "Stale", "application_settings_conflict"),
  );
  store.setPreference("theme", "dark");
  await settled();
  const remote = deferred<ApplicationSettings>();
  vi.mocked(api.getApplicationSettings).mockReturnValueOnce(remote.promise);
  const reload = store.reloadFailed();
  store.setPreference("accent", "purple");
  remote.resolve(original);
  await reload;
  expect(store.readPreferences()).toMatchObject({
    theme: "dark",
    accent: "purple",
  });
  expect(store.getStatus().failed).toBe(true);
});

// A replaced/stopped runtime must ignore late bootstrap replies and avoid starting new old-session mutations.
test("ignores delayed bootstrap completions after session disposal", async () => {
  const pending = deferred<ApplicationSettings>();
  vi.mocked(api.getApplicationSettings).mockReturnValue(pending.promise);
  const loading = store.initialize(api);
  store.dispose();
  pending.resolve(original);
  await loading;
  expect(store.getStatus().phase).toBe("idle");
  expect(store.readPreferences()).toBeUndefined();
});

// Cross-tab invalidations and returning to the window reload authoritative values without browser writes.
test("refreshes on tab broadcasts and focus, and releases connections on disposal", async () => {
  class MockChannel {
    static instances: MockChannel[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    postMessage = vi.fn();
    close = vi.fn();
    constructor() {
      MockChannel.instances.push(this);
    }
  }
  vi.stubGlobal("BroadcastChannel", MockChannel);
  await store.initialize(api);
  const disconnect = store.connect();
  const channel = MockChannel.instances[0]!;
  vi.mocked(api.getApplicationSettings).mockResolvedValue({
    ...original,
    revision: 1,
    preferences: { ...original.preferences, accent: "orange" },
  });
  channel!.onmessage!({ data: "changed" });
  await vi.waitFor(() =>
    expect(store.readPreferences()?.accent).toBe("orange"),
  );
  vi.mocked(api.getApplicationSettings).mockResolvedValue({
    ...original,
    revision: 2,
    preferences: { ...original.preferences, theme: "dark" },
  });
  window.dispatchEvent(new Event("focus"));
  await vi.waitFor(() => expect(store.readPreferences()?.theme).toBe("dark"));
  store.dispose();
  disconnect();
  expect(channel!.close).toHaveBeenCalledOnce();
  const calls = vi.mocked(api.getApplicationSettings).mock.calls.length;
  window.dispatchEvent(new Event("focus"));
  expect(api.getApplicationSettings).toHaveBeenCalledTimes(calls);
});

// Closing while known preferences are unsaved must not silently imply they were safely stored.
test("protects unsaved preference changes on unload and stops blocking after acknowledgement", async () => {
  vi.stubGlobal("BroadcastChannel", undefined);
  await store.initialize(api);
  store.connect();
  const pending = deferred<ApplicationSettings>();
  vi.mocked(api.updateApplicationSettings).mockReturnValue(pending.promise);
  store.setPreference("theme", "dark");
  const before = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(before);
  expect(before.defaultPrevented).toBe(true);
  pending.resolve({
    ...original,
    revision: 1,
    preferences: { ...original.preferences, theme: "dark" },
  });
  await settled();
  const after = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(after);
  expect(after.defaultPrevented).toBe(false);
});

// Lost acknowledgements may have committed; retrying an old revision must stop at conflict instead of overwriting.
test("recovers a lost save acknowledgement through explicit authoritative reload", async () => {
  await store.initialize(api);
  vi.mocked(api.updateApplicationSettings)
    .mockRejectedValueOnce(new TypeError("Reply lost"))
    .mockRejectedValueOnce(
      new ApiError(409, "Stale", "application_settings_conflict"),
    );
  store.setPreference("theme", "dark");
  await settled();
  store.retryFailed();
  await settled();
  expect(store.getStatus().conflict).toBe(true);
  expect(api.updateApplicationSettings).toHaveBeenNthCalledWith(2, 0, {
    theme: "dark",
  });
  vi.mocked(api.getApplicationSettings).mockResolvedValue({
    ...original,
    revision: 1,
    preferences: { ...original.preferences, theme: "dark" },
  });
  await store.reloadFailed();
  expect(store.getStatus()).toMatchObject({ failed: false, pending: 0 });
  expect(store.readPreferences()?.theme).toBe("dark");
});

// Optional browser tab channels must not prevent loading or turn an acknowledged backend save into a failure.
test("keeps persistence usable when browser broadcast construction or delivery is blocked", async () => {
  class BlockedDelivery {
    postMessage() {
      throw new Error("Blocked");
    }
    close() {}
  }
  vi.stubGlobal("BroadcastChannel", BlockedDelivery);
  await store.initialize(api);
  store.connect();
  vi.mocked(api.updateApplicationSettings).mockResolvedValue({
    ...original,
    revision: 1,
    preferences: { ...original.preferences, theme: "dark" },
  });
  store.setPreference("theme", "dark");
  await settled();
  expect(store.getStatus()).toMatchObject({ failed: false, pending: 0 });
  store.dispose();
  store = createPreferenceStore();
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      constructor() {
        throw new Error("Blocked");
      }
    },
  );
  await store.initialize(api);
  expect(() => store.connect()).not.toThrow();
});
