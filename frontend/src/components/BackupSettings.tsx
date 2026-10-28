import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../services/api";
import { createBackup, downloadBackup, listBackups } from "../services/backups";
import type { StoredBackup } from "../types/backup";
import { archiveSize } from "./archiveMessages";

/**
 * Manage durable data backups within the application settings.
 * @param onBusyChange Notify the parent while a consistent backup is being created.
 * @returns Backup creation, status and native download controls.
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
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [reload, setReload] = useState(0);
  const working = useRef(false);
  const locale = i18n.resolvedLanguage ?? "en";

  useEffect(() => {
    const controller = new AbortController();
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
    return () => controller.abort();
  }, [reload]);

  /**
   * Save one backup and refresh its catalog without retrying an uncertain creation.
   * @returns Completion after creation and the subsequent list refresh have settled.
   */
  async function save() {
    if (working.current || needsReload) return;
    working.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setSaved(false);
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
      setSaved(true);
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

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm text-muted">{t("backups.description")}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || loading || needsReload}
          onClick={() => void save()}
          className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface enabled:hover:bg-accent-hover disabled:opacity-50"
        >
          {t(busy ? "backups.creating" : "backups.create")}
        </button>
        <button
          type="button"
          disabled={busy || loading}
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
      {saved && (
        <p role="status" className="text-sm text-success">
          {t("backups.created")}
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
                    disabled={busy}
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
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
