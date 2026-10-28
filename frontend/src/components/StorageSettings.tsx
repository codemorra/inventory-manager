import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { preferenceStore } from "../preferences/store";
import { ApiError } from "../services/api";
import {
  cancelStorageMove,
  getStorageLocations,
  changeStorageLocations,
} from "../services/storage";
import type {
  StorageDirectories,
  StorageLocationState,
} from "../types/storage";

/** Apply checked live storage changes independently of appearance preferences. */
export function StorageSettings({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [state, setState] = useState<StorageLocationState>();
  const [draft, setDraft] = useState<StorageDirectories>({
    dataDirectory: "",
    backupsDirectory: "",
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [changed, setChanged] = useState(false);
  const preferences = useSyncExternalStore(
    preferenceStore.subscribe,
    preferenceStore.getStatus,
    preferenceStore.getStatus,
  );
  function accept(next: StorageLocationState) {
    setState(next);
    setDraft(
      next.pending ?? {
        dataDirectory: next.paths.dataDirectory,
        backupsDirectory: next.paths.backupsDirectory,
      },
    );
  }
  useEffect(() => {
    let active = true;
    void getStorageLocations()
      .then((next) => {
        if (active) {
          accept(next);
          setError(undefined);
        }
      })
      .catch(() => {
        if (active) setError("storage.loadFailed");
      });
    return () => {
      active = false;
    };
  }, [reload]);

  async function submit(cancel: boolean) {
    if (!state) return;
    setBusy(true);
    onBusyChange(true);
    setError(undefined);
    setChanged(false);
    try {
      // Ordinary appearance saves share the settings revision; refresh it without accepting another path plan.
      const current = await getStorageLocations();
      if (
        JSON.stringify(current.pending) !== JSON.stringify(state.pending) ||
        current.paths.dataDirectory !== state.paths.dataDirectory ||
        current.paths.backupsDirectory !== state.paths.backupsDirectory ||
        current.cleanupPending !== state.cleanupPending
      )
        throw new ApiError(
          409,
          "Storage locations changed.",
          "storage_location_conflict",
        );
      const next = cancel
        ? await cancelStorageMove(current.revision)
        : await changeStorageLocations(current.revision, draft);
      accept(next);
      setChanged(!cancel && !next.moveFailed);
      await preferenceStore.refresh();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 409
          ? "storage.conflict"
          : failure instanceof ApiError && failure.status === 422
            ? "storage.invalid"
            : "storage.saveFailed",
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  const blocked = busy || preferences.pending > 0 || preferences.failed;
  const unchanged =
    state &&
    draft.dataDirectory === state.paths.dataDirectory &&
    draft.backupsDirectory === state.paths.backupsDirectory;
  return (
    <div className="mt-3 space-y-4">
      <p className="text-sm text-muted">{t("storage.description")}</p>
      {busy && (
        <p role="status" className="text-sm text-muted">
          {t("storage.saving")}
        </p>
      )}
      {changed && (
        <p role="status" className="text-sm text-success">
          {t("storage.changed")}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger"
        >
          <p>{t(error)}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setState(undefined);
              setReload((value) => value + 1);
            }}
            className="mt-2 underline"
          >
            {t("storage.reload")}
          </button>
        </div>
      )}
      {!state && !error && (
        <p role="status" className="text-sm text-muted">
          {t("storage.loading")}
        </p>
      )}
      {state && (
        <>
          {state.pending && (
            <p
              role="status"
              className="rounded-md border border-accent/40 bg-accent-soft p-3 text-sm"
            >
              {t("storage.pending")}
            </p>
          )}
          {state.moveFailed && (
            <p
              role="alert"
              className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger"
            >
              {t("storage.moveFailed")}
            </p>
          )}
          {state.cleanupPending && (
            <p role="status" className="text-sm text-muted">
              {t("storage.cleanupPending")}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(false);
            }}
            className="space-y-3"
          >
            <fieldset
              disabled={
                blocked || Boolean(state.pending) || state.cleanupPending
              }
              className="space-y-3 disabled:opacity-60"
            >
              {(["dataDirectory", "backupsDirectory"] as const).map((key) => (
                <div key={key} className="text-sm">
                  <label
                    htmlFor={`${id}-${key}`}
                    className="mb-1 block font-medium"
                  >
                    {t(`storage.${key}`)}
                  </label>
                  <input
                    id={`${id}-${key}`}
                    aria-describedby={`${id}-${key}-current`}
                    type="text"
                    required
                    spellCheck={false}
                    disabled={key === "dataDirectory" && !state.dataMovable}
                    value={draft[key]}
                    onChange={(event) =>
                      setDraft((previous) => ({
                        ...previous,
                        [key]: event.target.value,
                      }))
                    }
                    className="w-full rounded-md border border-shell bg-control px-3 py-2 text-sm disabled:opacity-60"
                  />
                  <span
                    id={`${id}-${key}-current`}
                    className="mt-1 block text-xs text-muted break-all"
                  >
                    {t("storage.current", { path: state.paths[key] })}
                  </span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={
                        (key === "dataDirectory" && !state.dataMovable) ||
                        draft[key] === state.defaults[key]
                      }
                      onClick={() =>
                        setDraft((previous) => ({
                          ...previous,
                          [key]: state.defaults[key],
                        }))
                      }
                      aria-label={t("storage.defaultLabel", {
                        folder: t(`storage.${key}`),
                      })}
                      title={state.defaults[key]}
                      className="rounded-md border border-shell px-2 py-1 text-xs enabled:hover:bg-control-hover disabled:opacity-50"
                    >
                      {t("storage.default")}
                    </button>
                  </div>
                </div>
              ))}
              {!state.dataMovable && (
                <p className="text-xs text-muted">{t("storage.overridden")}</p>
              )}
              <button
                type="submit"
                disabled={
                  blocked ||
                  unchanged ||
                  !draft.dataDirectory ||
                  !draft.backupsDirectory
                }
                className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
              >
                {t(busy ? "storage.saving" : "storage.schedule")}
              </button>
            </fieldset>
          </form>
          {state.pending && (
            <button
              type="button"
              disabled={blocked}
              onClick={() => void submit(true)}
              className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
            >
              {t("storage.cancel")}
            </button>
          )}
          <details className="text-xs text-muted">
            <summary className="cursor-pointer">
              {t("storage.fixedPaths")}
            </summary>
            <dl className="mt-2 space-y-2">
              {(
                ["settingsPath", "logsDirectory", "tempDirectory"] as const
              ).map((key) => (
                <div key={key}>
                  <dt className="font-medium">{t(`storage.${key}`)}</dt>
                  <dd className="break-all">{state.paths[key]}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}
    </div>
  );
}
