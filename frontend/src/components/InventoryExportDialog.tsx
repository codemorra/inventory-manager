import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Inventory } from "../types/inventory";
import {
  discardInventoryExport,
  downloadInventoryExport,
  prepareInventoryExport,
} from "../services/inventoryArchives";
import type { PreparedInventoryExport } from "../types/inventoryArchive";
import { archiveErrorKey, archiveSize } from "./archiveMessages";
import { Modal } from "./Modal";

/** Prepare a saved inventory ZIP, then hand its completed artifact to the browser's native download. */
export function InventoryExportDialog({
  inventory,
  onClose,
}: {
  inventory: Inventory;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [prepared, setPrepared] = useState<PreparedInventoryExport | null>(
    null,
  );
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const current = useRef<PreparedInventoryExport | null>(null);
  const generation = useRef(0);

  async function run(abort: AbortController, version: number) {
    try {
      const result = await prepareInventoryExport(inventory.id, abort.signal);
      if (version !== generation.current || abort.signal.aborted) {
        void discardInventoryExport(inventory.id, result.id).catch(() => {});
        return;
      }
      current.current = result;
      setPrepared(result);
    } catch (error) {
      if (version === generation.current && !abort.signal.aborted)
        setError(archiveErrorKey(error, "archives.exportFailed"));
    } finally {
      if (version === generation.current) setBusy(false);
    }
  }
  function prepare() {
    const version = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError("");
    void run(abort, version);
  }
  useEffect(() => {
    const counter = generation;
    const version = ++counter.current;
    const abort = new AbortController();
    controller.current = abort;
    void run(abort, version);
    return () => {
      counter.current++;
      controller.current?.abort();
      if (current.current)
        void discardInventoryExport(inventory.id, current.current.id).catch(
          () => {},
        );
      current.current = null;
    };
    // Each context action mounts a fresh export session for this immutable source identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory.id]);

  function download() {
    if (!prepared || !current.current) return;
    if (Date.parse(prepared.expires_at) <= Date.now()) {
      setError("archives.exportExpired");
      setPrepared(null);
      void discardInventoryExport(inventory.id, prepared.id).catch(() => {});
      current.current = null;
      return;
    }
    downloadInventoryExport(inventory.id, prepared);
    current.current = null;
    onClose();
  }
  return (
    <Modal title={t("archives.export")} size="small" onClose={onClose}>
      <p className="wrap-break-word font-medium text-heading">
        {inventory.name}
      </p>
      <p className="mt-2 text-sm text-muted">{t("archives.exportHelp")}</p>
      {busy && (
        <p role="status" className="mt-4 text-sm text-muted">
          {t("archives.preparingExport")}
        </p>
      )}
      {prepared && (
        <p className="mt-4 wrap-break-word text-sm">
          {prepared.filename} ·{" "}
          {archiveSize(prepared.byte_size, i18n.resolvedLanguage ?? "en")}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-md bg-danger-soft p-3 text-sm text-danger"
        >
          {t(error)}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="rounded-md border border-shell px-3 py-2 text-sm font-medium hover:bg-control-hover"
        >
          {t("common.actions.cancel")}
        </button>
        {!prepared && !busy && (
          <button
            type="button"
            onClick={() => void prepare()}
            className="rounded-md border border-shell px-3 py-2 text-sm font-medium hover:bg-control-hover"
          >
            {t("common.actions.retry")}
          </button>
        )}
        {prepared && (
          <button
            type="button"
            onClick={download}
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface hover:bg-accent-hover"
          >
            {t("archives.download")}
          </button>
        )}
      </div>
    </Modal>
  );
}
