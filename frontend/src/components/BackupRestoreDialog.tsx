import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../services/api";
import {
  confirmBackupRestore,
  discardBackupRestore,
  prepareBackupRestore,
  readBackupRestore,
  reloadAfterRestore,
} from "../services/backups";
import type { RestorePreview, RestoreReceipt } from "../types/backup";
import { archiveSize } from "./archiveMessages";
import { Modal } from "./Modal";

/**
 * Validate a backup and require explicit confirmation before replacing application data.
 * @param source The selected stored archive basename or external ZIP File.
 * @param onClose Dismiss an unused or safely failed preview.
 * @param onBusyChange Keep parent settings mounted during validation and confirmation.
 * @returns Validation progress, checked summary, confirmation and lost-response recovery controls.
 */
export function BackupRestoreDialog({
  source,
  onClose,
  onBusyChange,
}: {
  source: string | File;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [receipt, setReceipt] = useState<RestoreReceipt | null>(null);
  const [checking, setChecking] = useState(true);
  const [pending, setPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState("");
  const filename = typeof source === "string" ? source : source.name;
  const [trigger] = useState(() => document.activeElement);
  const current = useRef<string | null>(null);
  const attempt = useRef(false);
  const working = useRef(false);
  const counter = useRef(0);
  const abort = useRef<AbortController | null>(null);

  /**
   * Validate one immutable source, discarding late replies from canceled selections.
   * @param source The managed archive basename or original local File.
   * @returns Completion once the checked summary or preparation error is displayed.
   */
  async function prepare(source: string | File) {
    const version = ++counter.current;
    abort.current?.abort();
    if (current.current)
      void discardBackupRestore(current.current).catch(() => {});
    current.current = null;
    const controller = new AbortController();
    abort.current = controller;
    setChecking(true);
    setPreview(null);
    setError("");
    setExpired(false);
    onBusyChange(true);
    try {
      const result = await prepareBackupRestore(source, controller.signal);
      if (controller.signal.aborted || version !== counter.current) {
        void discardBackupRestore(result.id).catch(() => {});
        return;
      }
      current.current = result.id;
      setPreview(result);
    } catch (failure) {
      if (!controller.signal.aborted && version === counter.current)
        setError(
          failure instanceof ApiError &&
            failure.code === "invalid_backup_archive"
            ? "backups.restoreInvalid"
            : "backups.restorePrepareFailed",
        );
    } finally {
      if (version === counter.current) {
        setChecking(false);
        onBusyChange(false);
      }
    }
  }

  useEffect(() => {
    const lifecycle = counter;
    let mounted = true;
    void Promise.resolve().then(() => {
      if (mounted) return prepare(source);
    });
    return () => {
      mounted = false;
      lifecycle.current++;
      abort.current?.abort();
      if (current.current && !attempt.current)
        void discardBackupRestore(current.current).catch(() => {});
      onBusyChange(false);
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
    // Each mounted dialog owns the selected immutable source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Restore the displayed selection once, or recover the original attempt without repeating it.
   * @param recover Whether to read status instead of issuing a confirmation.
   * @returns Completion after the authoritative outcome or a retryable status error is displayed.
   */
  async function restore(recover: boolean) {
    if (!preview || working.current || expired) return;
    if (!recover && Date.parse(preview.expires_at) <= Date.now()) {
      setExpired(true);
      setError("backups.restoreExpired");
      return;
    }
    working.current = true;
    attempt.current = true;
    setPending(true);
    onBusyChange(true);
    setError("");
    let completed = false;
    let unknown = false;
    try {
      if (recover) {
        const status = await readBackupRestore(preview.id);
        if (status.status === "completed") {
          setReceipt(status.receipt);
          completed = true;
        } else if (status.status === "restoring") {
          setUncertain(true);
          unknown = true;
          setError("backups.restoreStillRunning");
        } else {
          setUncertain(false);
          attempt.current = false;
          setError("backups.restoreNotApplied");
        }
      } else {
        setReceipt(await confirmBackupRestore(preview.id));
        completed = true;
      }
    } catch (failure) {
      unknown =
        recover || !(failure instanceof ApiError) || failure.status >= 500;
      setUncertain(unknown);
      if (
        failure instanceof ApiError &&
        failure.code === "backup_restore_not_found"
      ) {
        setExpired(true);
        unknown = false;
        setUncertain(false);
      }
      if (!unknown) attempt.current = false;
      setError(
        unknown
          ? "backups.restoreUncertain"
          : failure instanceof ApiError &&
              failure.code === "backup_restore_not_found"
            ? "backups.restoreExpired"
            : "backups.restoreFailed",
      );
    } finally {
      working.current = false;
      setPending(false);
      onBusyChange(completed || unknown);
    }
  }

  return (
    <Modal
      title={t("backups.restoreTitle")}
      size="small"
      closeDisabled={pending || uncertain || Boolean(receipt)}
      onClose={onClose}
    >
      <div className="space-y-4">
        {filename && <p className="break-all text-xs text-muted">{filename}</p>}
        {checking && (
          <p role="status" className="text-sm text-muted">
            {t("backups.restoreChecking")}
          </p>
        )}
        {preview && !receipt && (
          <>
            <p className="text-sm font-medium">
              {t("backups.restoreDate", {
                date: new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "en", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(preview.backup.created_at)),
              })}
            </p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt>{t("backups.restoreInventories")}</dt>
              <dd className="text-right">{preview.counts.inventories}</dd>
              <dt>{t("backups.restoreItems")}</dt>
              <dd className="text-right">{preview.counts.items}</dd>
              <dt>{t("backups.restoreAttachments")}</dt>
              <dd className="text-right">
                {preview.counts.attachments} ·{" "}
                {archiveSize(
                  preview.attachment_bytes,
                  i18n.resolvedLanguage ?? "en",
                )}
              </dd>
            </dl>
            <p className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">
              {t("backups.restoreWarning")}
            </p>
            <p className="text-sm text-muted">{t("backups.restoreSafety")}</p>
          </>
        )}
        {pending && (
          <p role="status" className="text-sm text-muted">
            {t(uncertain ? "backups.restoreRecovering" : "backups.restoring")}
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-md bg-danger-soft p-3 text-sm text-danger"
          >
            {t(error)}
          </p>
        )}
        {receipt && (
          <p role="status" className="text-sm text-success">
            {t("backups.restored")}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {!receipt && !uncertain && (
            <button
              type="button"
              disabled={pending}
              onClick={onClose}
              className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
            >
              {t("common.actions.cancel")}
            </button>
          )}
          {!preview && !checking && (
            <button
              type="button"
              onClick={() => void prepare(source)}
              className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover"
            >
              {t("common.actions.retry")}
            </button>
          )}
          {preview && !receipt && !uncertain && (
            <button
              type="button"
              disabled={pending || expired}
              onClick={() => void restore(false)}
              className="rounded-md bg-danger-soft px-3 py-2 text-sm font-semibold text-danger enabled:hover:bg-danger/25 disabled:opacity-50"
            >
              {t("backups.confirmRestore")}
            </button>
          )}
          {uncertain && (
            <button
              type="button"
              disabled={pending}
              onClick={() => void restore(true)}
              className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
            >
              {t("backups.checkRestore")}
            </button>
          )}
          {(receipt || uncertain) && (
            <button
              type="button"
              disabled={pending}
              onClick={reloadAfterRestore}
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface enabled:hover:bg-accent-hover disabled:opacity-50"
            >
              {t("backups.reloadApplication")}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
