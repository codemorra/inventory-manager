import { type SyntheticEvent, useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useInventoryGroups } from "../hooks/useInventoryGroups";
import { ApiError } from "../services/api";
import {
  confirmInventoryImport,
  discardInventoryImport,
  prepareInventoryImport,
  readInventoryImport,
} from "../services/inventoryArchives";
import type {
  InventoryImportInput,
  InventoryImportPreview,
} from "../types/inventoryArchive";
import { archiveErrorKey, archiveSize } from "./archiveMessages";
import { ChoiceSelect } from "./ChoiceSelect";
import { Modal } from "./Modal";

/**
 * Keep an import session mounted across dismissal so an uncertain confirmation can be recovered on reopening.
 * @param props Visibility and dismissal controlled by the shared application shell, outside mobile navigation.
 */
export function InventoryImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const groups = useInventoryGroups();
  const id = useId();
  const [preview, setPreview] = useState<InventoryImportPreview | null>(null);
  const [filename, setFilename] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [groupId, setGroupId] = useState("");
  const [checking, setChecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const current = useRef<InventoryImportPreview | null>(null);
  const attempt = useRef<{ id: string; data: InventoryImportInput } | null>(
    null,
  );
  const submitting = useRef(false);
  const resolving = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const counter = generation;
    mounted.current = true;
    return () => {
      mounted.current = false;
      counter.current++;
      controller.current?.abort();
      // An unknown/active confirmation must retain its receipt rather than canceling a possible success.
      if (current.current && !attempt.current)
        void discardInventoryImport(current.current.id).catch(() => {});
      current.current = null;
    };
  }, []);

  function clearStage() {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    if (current.current && !attempt.current)
      void discardInventoryImport(current.current.id).catch(() => {});
    current.current = null;
    setPreview(null);
    setChecking(false);
    setFilename("");
    setExpired(false);
    setError("");
  }
  function close() {
    if (submitting.current || resolving.current) return;
    // Keep uncertain state in this shell-owned component when hidden, ready to check on reopening.
    if (!attempt.current) clearStage();
    onClose();
  }
  async function selectFile(file: File) {
    if (submitting.current || attempt.current || resolving.current) return;
    clearStage();
    const version = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setFilename(file.name);
    setChecking(true);
    try {
      const result = await prepareInventoryImport(file, abort.signal);
      if (
        !mounted.current ||
        version !== generation.current ||
        abort.signal.aborted
      ) {
        void discardInventoryImport(result.id).catch(() => {});
        return;
      }
      current.current = result;
      setPreview(result);
      setName(result.inventory.name);
      setDescription(result.inventory.description ?? "");
      setGroupId("");
    } catch (error) {
      if (
        mounted.current &&
        version === generation.current &&
        !abort.signal.aborted
      )
        setError(archiveErrorKey(error, "archives.checkFailed"));
    } finally {
      if (mounted.current && version === generation.current) setChecking(false);
    }
  }
  async function finish(inventoryId: string) {
    // Receipt cleanup never deletes the imported inventory or its managed files.
    const token = attempt.current?.id ?? current.current?.id;
    current.current = null;
    attempt.current = null;
    void client.invalidateQueries({ queryKey: ["inventories"], exact: true });
    if (token) void discardInventoryImport(token).catch(() => {});
    if (!mounted.current) return;
    setPreview(null);
    setUncertain(false);
    setExpired(false);
    setError("");
    setFilename("");
    navigate(`/inventories/${inventoryId}/items`);
    onClose();
  }
  function markExpired(message: string) {
    attempt.current = null;
    current.current = null;
    setExpired(true);
    setUncertain(false);
    setError(message);
    void client.invalidateQueries({ queryKey: ["inventories"], exact: true });
  }
  async function confirm(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submitting.current ||
      resolving.current ||
      !current.current ||
      attempt.current ||
      !name.trim() ||
      expired
    )
      return;
    if (Date.parse(current.current.expires_at) <= Date.now()) {
      void discardInventoryImport(current.current.id).catch(() => {});
      markExpired("archives.importExpired");
      return;
    }
    const captured = {
      id: current.current.id,
      data: {
        name: name.trim(),
        description: description.trim() || null,
        group_id: groupId || null,
      },
    };
    attempt.current = captured;
    submitting.current = true;
    setConfirming(true);
    setError("");
    try {
      const result = await confirmInventoryImport(captured.id, captured.data);
      await finish(result.id);
    } catch (error) {
      if (!mounted.current) return;
      if (
        error instanceof ApiError &&
        (error.status === 422 || error.code === "inventory_group_not_found")
      ) {
        attempt.current = null;
        setError(archiveErrorKey(error, "archives.importFailed"));
      } else if (
        error instanceof ApiError &&
        error.code === "inventory_import_not_found"
      )
        markExpired("archives.resultUnavailable");
      else {
        setUncertain(true);
        setError("archives.uncertain");
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setConfirming(false);
    }
  }
  async function recover() {
    if (resolving.current || submitting.current || !attempt.current) return;
    resolving.current = true;
    setRecovering(true);
    try {
      const status = await readInventoryImport(attempt.current.id);
      if (!mounted.current) return;
      if (status.status === "completed" && status.inventory_id)
        await finish(status.inventory_id);
      else if (status.status === "importing")
        setError("archives.stillImporting");
      else {
        // Authoritative ready status means no publication is running; the preserved inputs can be corrected/retried.
        attempt.current = null;
        current.current = status;
        setPreview(status);
        setUncertain(false);
        setError("archives.retryImport");
      }
    } catch (error) {
      if (!mounted.current) return;
      if (
        error instanceof ApiError &&
        error.code === "inventory_import_not_found"
      )
        markExpired("archives.resultUnavailable");
      else setError("archives.statusFailed");
    } finally {
      resolving.current = false;
      if (mounted.current) setRecovering(false);
    }
  }
  if (!open) return null;
  const locked = confirming || recovering || uncertain;
  const inputClass =
    "mt-1.5 w-full rounded-md border border-shell bg-surface px-3 py-2 text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60";
  return (
    <Modal
      title={t("archives.import")}
      size="medium"
      onClose={close}
      contentClassName="flex min-h-0 flex-col"
    >
      <form
        onSubmit={(event) => void confirm(event)}
        className="flex min-h-0 flex-col"
      >
        <div className="max-h-[60dvh] space-y-4 overflow-y-auto pr-1">
          <p className="text-sm text-muted">{t("archives.importHelp")}</p>
          <label className="block text-sm font-medium">
            {t("archives.archiveFile")}
            <input
              ref={fileInput}
              autoFocus
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              disabled={locked}
              className={`${inputClass} file:mr-3 file:rounded-sm file:border-0 file:bg-control-hover file:px-2 file:py-1 file:text-foreground`}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void selectFile(file);
              }}
            />
          </label>
          {filename && (
            <p title={filename} className="wrap-break-word text-sm text-muted">
              {filename}
            </p>
          )}
          {checking && (
            <p role="status" className="text-sm text-muted">
              {t("archives.checking")}
            </p>
          )}
          {preview && (
            <>
              <dl
                aria-label={t("archives.summary")}
                className="grid grid-cols-2 gap-3 rounded-md border border-shell bg-surface-muted p-3 text-sm"
              >
                {[
                  ["fields", preview.field_count],
                  ["items", preview.item_count],
                  ["files", preview.attachment_count],
                ].map(([label, count]) => (
                  <div key={label}>
                    <dt className="text-muted">{t(`archives.${label}`)}</dt>
                    <dd className="font-medium">{count}</dd>
                  </div>
                ))}
                <div>
                  <dt className="text-muted">{t("archives.fileSize")}</dt>
                  <dd className="font-medium">
                    {archiveSize(
                      preview.attachment_bytes,
                      i18n.resolvedLanguage ?? "en",
                    )}
                  </dd>
                </div>
              </dl>
              <label className="block text-sm font-medium">
                {t("common.fields.name")}
                <input
                  className={inputClass}
                  maxLength={255}
                  required
                  value={name}
                  disabled={locked || expired}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block text-sm font-medium">
                {t("common.fields.description")}
                <textarea
                  className={`${inputClass} min-h-20 resize-y`}
                  value={description}
                  disabled={locked || expired}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <ChoiceSelect
                id={`${id}-group`}
                label={t("templates.destinationGroup")}
                portal
                options={[
                  { value: "", label: t("templates.ungrouped") },
                  ...(groups.data ?? []).map((group) => ({
                    value: group.id,
                    label: group.name,
                  })),
                ]}
                value={groupId}
                onChange={setGroupId}
                disabled={locked || expired || groups.isPending}
              />
              {groups.isError && (
                <p role="alert" className="text-sm text-danger">
                  {t("templates.groupsFailed")}{" "}
                  <button
                    type="button"
                    disabled={locked || groups.isFetching}
                    className="underline"
                    onClick={() => void groups.refetch()}
                  >
                    {t("common.actions.retry")}
                  </button>
                </p>
              )}
            </>
          )}
          {confirming && (
            <p role="status" className="text-sm text-muted">
              {t("archives.importing")}
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
        </div>
        <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2 border-t border-shell pt-4">
          <button
            type="button"
            onClick={close}
            disabled={confirming || recovering}
            className="rounded-md border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover disabled:opacity-50"
          >
            {t(uncertain ? "archives.close" : "common.actions.cancel")}
          </button>
          {uncertain ? (
            <button
              type="button"
              disabled={recovering}
              onClick={() => void recover()}
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface disabled:opacity-50"
            >
              {t(
                recovering ? "archives.checkingStatus" : "archives.checkStatus",
              )}
            </button>
          ) : (
            <button
              type="submit"
              disabled={
                !preview || checking || confirming || expired || !name.trim()
              }
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface enabled:hover:bg-accent-hover disabled:opacity-50"
            >
              {t(confirming ? "archives.importing" : "archives.importAction")}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
