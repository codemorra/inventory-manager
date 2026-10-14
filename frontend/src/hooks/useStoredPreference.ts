import { useSyncExternalStore } from "react";

const preferenceEvent = "inventory-preference-change";

/**
 * Subscribe to preference changes across controls and browser tabs.
 * @param onChange Callback that refreshes the stored preference.
 * @returns A function that removes the subscriptions.
 */
function subscribe(onChange: () => void) {
  window.addEventListener(preferenceEvent, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(preferenceEvent, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Keep duplicated preference controls synchronized through local storage.
 * @param key The local storage key for the preference.
 * @param read The function that reads and validates the stored value.
 * @returns The current value and a setter shared across controls.
 */
export function useStoredPreference<T extends string>(
  key: string,
  read: () => T,
) {
  const value = useSyncExternalStore(subscribe, read, read);

  /**
   * Persist a preference and notify controls in the current window.
   * @param nextValue The preference to store.
   */
  function setValue(nextValue: T) {
    localStorage.setItem(key, nextValue);
    window.dispatchEvent(new Event(preferenceEvent));
  }

  return [value, setValue] as const;
}
