import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../services/api";
import {
  createBackup,
  deleteBackup,
  downloadBackup,
  listBackups,
} from "../services/backups";
import type { StoredBackup } from "../types/backup";
import { archiveSize } from "./archiveMessages";
import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";
import { BackupRestoreDialog } from "./BackupRestoreDialog";
import { AutomaticBackupSettings } from "./AutomaticBackupSettings";

/**
 * Manage durable data backups within the application settings.
 * @param onBusyChange Notify the parent while a backup operation is awaiting its result.
 * @returns Backup creation, confirmed deletion, status and native download controls.
 */
export function BackupSettings({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [backups, setBackups] = useState<StoredBackup[]>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [policyBusy, setPolicyBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<"created" | "deleted" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredBackup | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | File | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [reload, setReload] = useState(0);
  const working = useRef(false);
  const catalogVersion = useRef(0);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const restoreFileInput = useRef<HTMLInputElement>(null);
  const focusRefresh = useRef(false);
  const locale = i18n.resolvedLanguage ?? "en";
  const blocked =
    busy ||
    policyBusy ||
    deleting ||
    Boolean(deleteTarget) ||
    Boolean(restoreTarget);
  /**
   * Guard both parent settings and manual backup actions during a schedule save.
   * @param pending Whether the explicit configuration save is still running.
   * @returns No value; the shared backup panel reports the active operation to its parent.
   */
  const policyBusyChanged = useCallback(
    (pending: boolean) => {
      setPolicyBusy(pending);
      onBusyChange(pending);
    },
    [onBusyChange],
  );

  useEffect(() => {
    if (!deleteTarget && !deleting && !loading && focusRefresh.current) {
      focusRefresh.current = false;
      refreshButton.current?.focus();
    }
  }, [deleteTarget, deleting, loading]);

  useEffect(() => {
    const controller = new AbortController();
    let polling = false;
    void listBackups(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setBackups(result);
        setError("");
        setNeedsReload(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("backups.loadFailed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    /**
     * Refresh archives created automatically without replacing a more recent local mutation result.
     * @returns Completion after a best-effort catalog refresh.
     */
    async function poll() {
      if (polling || working.current) return;
      polling = true;
      const version = catalogVersion.current;
      try {
        const result = await listBackups(controller.signal);
        if (
          !controller.signal.aborted &&
          !working.current &&
          version === catalogVersion.current
        )
          setBackups(result);
      } catch {
        /* Preserve the last known catalog until the next check or explicit refresh. */
      } finally {
        polling = false;
      }
    }
    const interval = setInterval(() => {
      void poll();
    }, 60_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [reload]);

  /**
   * Save one backup and refresh its catalog without retrying an uncertain creation.
   * @returns Completion after creation and the subsequent list refresh have settled.
   */
  async function save() {
    if (working.current || needsReload) return;
    working.current = true;
    catalogVersion.current++;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setSuccess(null);
    try {
      const created = await createBackup();
      setBackups((previous) => [
        {
          filename: created.filename,
          byte_size: created.byte_size,
          metadata: {
            id: created.id,
            created_at: created.created_at,
            kind: created.kind,
          },
        },
        ...(previous ?? []).filter(
          (entry) => entry.filename !== created.filename,
        ),
      ]);
      setSuccess("created");
      try {
        setBackups(await listBackups());
      } catch {
        setError("backups.loadFailed");
      }
    } catch (failure) {
      const uncertain = !(failure instanceof ApiError) || failure.status >= 500;
      setNeedsReload(uncertain);
      setError(
        uncertain
          ? "backups.uncertain"
          : failure.code === "backup_conflict"
            ? "backups.conflict"
            : "backups.createFailed",
      );
    } finally {
      working.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  /**
   * Delete the confirmed archive once and preserve the target when the request fails.
   * @returns Completion after deletion settles; uncertain results require a list refresh.
   */
  async function remove() {
    if (!deleteTarget || working.current || needsReload) return;
    const filename = deleteTarget.filename;
    working.current = true;
    catalogVersion.current++;
    setDeleting(true);
    onBusyChange(true);
    setDeleteError(null);
    setError("");
    setSuccess(null);
    try {
      await deleteBackup(filename);
      setBackups((previous) =>
        previous?.filter((entry) => entry.filename !== filename),
      );
      setDeleteTarget(null);
      setSuccess("deleted");
      focusRefresh.current = true;
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === "backup_not_found") {
        setBackups((previous) =>
          previous?.filter((entry) => entry.filename !== filename),
        );
        setDeleteTarget(null);
        setError("backups.missing");
        focusRefresh.current = true;
      } else {
        const uncertain =
          !(failure instanceof ApiError) || failure.status >= 500;
        setNeedsReload(uncertain);
        setDeleteError(
          uncertain
            ? "backups.deleteUncertain"
            : failure.code === "backup_conflict"
              ? "backups.inUse"
              : "backups.deleteFailed",
        );
      }
    } finally {
      working.current = false;
      setDeleting(false);
      onBusyChange(false);
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-muted">{t("backups.description")}</p>
      <AutomaticBackupSettings
        disabled={blocked}
        onBusyChange={policyBusyChanged}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={blocked || loading || needsReload}
          onClick={() => void save()}
          className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface enabled:hover:bg-accent-hover disabled:opacity-50"
        >
          {t(busy ? "backups.creating" : "backups.create")}
        </button>
        <button
          type="button"
          disabled={blocked || loading || needsReload}
          onClick={() => restoreFileInput.current?.click()}
          className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
        >
          {t("backups.restoreFile")}
        </button>
        <input
          ref={restoreFileInput}
          type="file"
          accept=".zip,application/zip"
          aria-label={t("backups.chooseRestoreFile")}
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) setRestoreTarget(file);
          }}
        />
        <button
          type="button"
          ref={refreshButton}
          disabled={blocked || loading}
          onClick={() => {
            setLoading(true);
            setReload((value) => value + 1);
          }}
          className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
        >
          {t("backups.refresh")}
        </button>
      </div>
      {busy && (
        <p role="status" className="text-sm text-muted">
          {t("backups.creatingHelp")}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-success">
          {t(`backups.${success}`)}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger"
        >
          {t(error)}
        </p>
      )}
      {loading && (
        <p role="status" className="text-sm text-muted">
          {t("backups.loading")}
        </p>
      )}
      {backups?.length === 0 && !loading && (
        <p className="text-sm text-muted">{t("backups.empty")}</p>
      )}
      {Boolean(backups?.length) && (
        <ul
          aria-label={t("backups.list")}
          className="max-h-80 divide-y divide-shell overflow-y-auto rounded-md border border-shell"
        >
          {backups!.map((backup) => (
            <li key={backup.filename} className="space-y-2 p-3">
              <p className="break-all text-xs text-muted">{backup.filename}</p>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div>
                  {backup.metadata ? (
                    <>
                      <time
                        dateTime={backup.metadata.created_at}
                        className="font-medium"
                      >
                        {new Intl.DateTimeFormat(locale, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(backup.metadata.created_at))}
                      </time>
                      <span className="ml-2 text-muted">
                        {t(`backups.kinds.${backup.metadata.kind}`)}
                      </span>
                    </>
                  ) : (
                    <span className="text-danger">
                      {t("backups.unreadable")}
                    </span>
                  )}
                  <span className="ml-2 text-muted">
                    {archiveSize(backup.byte_size, locale)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={blocked || loading}
                    title={t("backups.download")}
                    aria-label={t("backups.downloadLabel", {
                      filename: backup.filename,
                    })}
                    onClick={() => downloadBackup(backup.filename)}
                    className="rounded-md border border-shell p-1.5 enabled:hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                  >
                    <svg
                      aria-hidden="true"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    disabled={blocked || loading || needsReload}
                    title={t("backups.restore")}
                    aria-label={t("backups.restoreLabel", {
                      filename: backup.filename,
                    })}
                    onClick={() => setRestoreTarget(backup.filename)}
                    className="rounded-md border border-shell p-1.5 enabled:hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                  >
                    <svg
                      aria-hidden="true"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                    >
                      <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    disabled={blocked || loading || needsReload}
                    title={t("common.actions.delete")}
                    aria-label={t("backups.deleteLabel", {
                      filename: backup.filename,
                    })}
                    onClick={() => {
                      setDeleteTarget(backup);
                      setDeleteError(null);
                    }}
                    className="rounded-md border border-shell p-1.5 text-danger enabled:hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
                  >
                    <svg
                      aria-hidden="true"
                      className="size-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                    >
                      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" />
                    </svg>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {deleteTarget && (
        <DeleteConfirmationDialog
          title={t("backups.deleteTitle")}
          message={t("backups.confirmDelete", {
            filename: deleteTarget.filename,
          })}
          isPending={deleting}
          confirmDisabled={needsReload}
          error={deleteError ? t(deleteError) : null}
          onConfirm={() => void remove()}
          onClose={() => {
            if (!working.current) {
              setDeleteTarget(null);
              setDeleteError(null);
            }
          }}
        >
          {needsReload && (
            <button
              type="button"
              disabled={deleting}
              onClick={() => {
                setDeleteTarget(null);
                setDeleteError(null);
                focusRefresh.current = true;
                setLoading(true);
                setReload((value) => value + 1);
              }}
              className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
            >
              {t("backups.refresh")}
            </button>
          )}
        </DeleteConfirmationDialog>
      )}
      {restoreTarget && (
        <BackupRestoreDialog
          source={restoreTarget}
          onClose={() => setRestoreTarget(null)}
          onBusyChange={onBusyChange}
        />
      )}
    </div>
  );
}
