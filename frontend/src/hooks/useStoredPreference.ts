import { useSyncExternalStore } from "react";
import { preferenceStore } from "../preferences/store";
import type { ApplicationPreferences } from "../types/preferences";

/** Share application preference controls through the revisioned backend store. */
export function useStoredPreference<K extends keyof ApplicationPreferences>(
  name: K,
) {
  const value = useSyncExternalStore(
    preferenceStore.subscribe,
    () => preferenceStore.readPreferences()?.[name],
    () => undefined,
  );
  function setValue(next: ApplicationPreferences[K]) {
    preferenceStore.setPreference(name, next);
  }
  return [value, setValue] as const;
}
