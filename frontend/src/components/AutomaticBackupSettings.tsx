import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { preferenceStore } from "../preferences/store";
import { ApiError } from "../services/api";
import {
  getBackupSchedule,
  updateBackupSchedule,
} from "../services/automaticBackups";
import type { BackupPolicy, BackupScheduleState } from "../types/backup";
import { ChoiceSelect } from "./ChoiceSelect";

/**
 * Edit automatic backup policy while background reads update only operational status.
 * @param disabled Whether another backup or storage operation prevents configuration changes.
 * @param onBusyChange Notify the parent until an explicit policy save has settled.
 * @param onDirtyChange Notify the parent when schedule changes have not been saved.
 * @returns Frequency, retention, last-success and retry/error controls in the current theme and language.
 */
export function AutomaticBackupSettings({
  disabled,
  onBusyChange,
  onDirtyChange,
}: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [base, setBase] = useState<BackupPolicy>();
  const [frequency, setFrequency] =
    useState<BackupPolicy["frequency"]>("disabled");
  const [retention, setRetention] = useState("10");
  const [status, setStatus] = useState<BackupScheduleState>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const working = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let polling = false;
    void getBackupSchedule(controller.signal)
      .then((state) => {
        if (controller.signal.aborted) return;
        setBase(state.policy);
        setFrequency(state.policy.frequency);
        setRetention(String(state.policy.retention));
        setStatus(state);
        setError("");
        setSaved(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("backups.scheduleLoadFailed");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    /**
     * Refresh displayed execution status without replacing the captured policy or current inputs.
     * @returns Completion once the status read settles; failed background reads preserve the last known state.
     */
    async function poll() {
      if (polling || working.current) return;
      polling = true;
      try {
        const state = await getBackupSchedule(controller.signal);
        if (!controller.signal.aborted && !working.current) setStatus(state);
      } catch {
        /* Keep the policy draft and last known status for explicit reload. */
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
   * Save only when the captured policy is unchanged, refreshing shared appearance revisions deliberately.
   * @returns Completion after the policy save and preference-cache refresh have settled.
   */
  async function submit() {
    if (!base || working.current) return;
    working.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    setSaved(false);
    try {
      const current = await getBackupSchedule();
      if (
        current.policy.frequency !== base.frequency ||
        current.policy.retention !== base.retention
      )
        throw new ApiError(
          409,
          "Backup policy has changed.",
          "application_settings_conflict",
        );
      const next = await updateBackupSchedule(current.revision, {
        frequency,
        retention: Number(retention),
      });
      setBase(next.policy);
      setStatus(next);
      setSaved(true);
      await preferenceStore.refresh();
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 409
          ? "backups.scheduleConflict"
          : "backups.scheduleSaveFailed",
      );
    } finally {
      working.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  /**
   * Format a validated scheduler timestamp using the current interface language.
   * @param value A UTC success or retry timestamp supplied by the backend.
   * @returns The local date and time suitable for the status description.
   */
  function timestamp(value: string) {
    return new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  const blocked = disabled || busy || loading;
  const validRetention =
    retention.trim() !== "" &&
    Number.isInteger(Number(retention)) &&
    Number(retention) >= 1 &&
    Number(retention) <= 1000;
  const changed =
    base &&
    (frequency !== base.frequency || Number(retention) !== base.retention);
  useEffect(() => {
    onDirtyChange?.(Boolean(changed));
  }, [changed, onDirtyChange]);
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-4 border-b border-shell pb-6"
    >
      <h3 id={`${id}-title`} className="text-sm font-semibold text-heading">
        {t("backups.automaticTitle")}
      </h3>
      <p className="text-sm text-muted">{t("backups.automaticHelp")}</p>
      {loading && (
        <p role="status" className="text-sm text-muted">
          {t("backups.scheduleLoading")}
        </p>
      )}
      {base && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!blocked && validRetention && changed) void submit();
          }}
        >
          <fieldset disabled={blocked} className="space-y-3">
            <div className="w-full max-w-48">
              <ChoiceSelect
                id={`${id}-frequency`}
                label={t("backups.frequency")}
                compact
                portal
                disabled={blocked}
                value={frequency}
                onChange={(value) =>
                  setFrequency(value as BackupPolicy["frequency"])
                }
                options={(["disabled", "daily", "weekly"] as const).map(
                  (value) => ({
                    value,
                    label: t(`backups.frequencies.${value}`),
                  }),
                )}
              />
            </div>
            {frequency === "weekly" && (
              <p className="text-xs text-muted">{t("backups.weeklyHelp")}</p>
            )}
            <label
              htmlFor={`${id}-retention`}
              className="block text-sm font-medium"
            >
              {t("backups.retention")}
            </label>
            <input
              id={`${id}-retention`}
              type="number"
              min={1}
              max={1000}
              step={1}
              required
              value={retention}
              onChange={(event) => setRetention(event.target.value)}
              className="w-24 rounded-md border border-shell bg-control px-3 py-2 text-sm"
            />
            <p className="text-xs text-muted">{t("backups.retentionHelp")}</p>
            <button
              type="submit"
              disabled={blocked || !validRetention || !changed}
              className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
            >
              {t(busy ? "backups.scheduleSaving" : "backups.scheduleSave")}
            </button>
          </fieldset>
        </form>
      )}
      {saved && (
        <p role="status" className="text-sm text-success">
          {t("backups.scheduleSaved")}
        </p>
      )}
      {status?.running && (
        <p role="status" className="text-sm text-muted">
          {t("backups.automaticRunning")}
        </p>
      )}
      {status && (
        <p className="text-xs text-muted">
          {status.last_success
            ? t("backups.lastAutomatic", {
                date: timestamp(status.last_success.completed_at),
              })
            : t("backups.noAutomaticYet")}
        </p>
      )}
      {status?.last_failure && (
        <p role="alert" className="text-sm text-danger">
          {t(
            status.last_failure.stage === "retention"
              ? "backups.retentionFailed"
              : "backups.automaticFailed",
          )}
          {status.next_retry_at && (
            <>
              {" "}
              {t("backups.retryAt", { date: timestamp(status.next_retry_at) })}
            </>
          )}
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
      {error && (
        <button
          type="button"
          disabled={busy || disabled || loading}
          onClick={() => {
            setLoading(true);
            setReload((value) => value + 1);
          }}
          className="text-xs underline disabled:opacity-50"
        >
          {t("backups.scheduleReload")}
        </button>
      )}
    </section>
  );
}
