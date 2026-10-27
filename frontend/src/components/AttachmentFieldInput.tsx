import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { InventoryField } from "../types/inventoryField";
import type { AttachmentDraft } from "./attachmentDraft";
import {
  attachmentDownloadUrl,
  downloadAttachment,
} from "../services/attachments";
import {
  largeAttachmentWarningBytes,
  useAttachmentWarnings,
} from "../hooks/useAttachmentWarnings";
import { Modal } from "./Modal";

// A missing draft makes standalone/read-only consumers safe without issuing network requests.
const emptyState: ReturnType<AttachmentDraft["getSnapshot"]> = {
  target: null,
  files: {},
  busy: false,
  error: false,
};
const emptySnapshot = () => emptyState;
const emptySubscribe = () => () => {};

/**
 * Add and remove files in a parent-owned draft, with an advisory warning for large local files.
 * @param props The field, current IDs, parent controller, and local change callback.
 * @returns File selection, staged/saved names, and an optional confirmation before upload.
 */
export function AttachmentFieldInput({
  field,
  value,
  disabled,
  draft,
  onChange,
  id,
}: {
  field: InventoryField;
  value: string[];
  disabled: boolean;
  draft?: AttachmentDraft | undefined;
  onChange: (ids: string[]) => void;
  id: string;
}) {
  const { t } = useTranslation();
  const state = useSyncExternalStore(
    draft?.subscribe ?? emptySubscribe,
    draft?.getSnapshot ?? emptySnapshot,
    draft?.getSnapshot ?? emptySnapshot,
  );
  const [warning, setWarning] = useAttachmentWarnings();
  const [selection, setSelection] = useState<File[] | null>(null);
  const [remember, setRemember] = useState(false);
  const busy = disabled || state.busy || !draft;

  /**
   * Append successful uploads to this cell; the controller rejects stale/canceled callbacks.
   * @param files The selected files accepted by the user.
   */
  function upload(files: File[]) {
    if (!draft || busy) return;
    let ids = value;
    void draft.upload(
      field,
      files,
      (file) => {
        ids = [...ids, file.id];
        onChange(ids);
      },
      id,
    );
  }

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium">
        {field.name}
        {field.is_required && (
          <span aria-hidden="true" className="ml-1 text-accent">
            *
          </span>
        )}
      </label>
      <ul className="mt-1 space-y-1">
        {value.map((fileId) => {
          const file = state.files[fileId];
          const name = file?.filename ?? t("attachments.unavailable");
          return (
            <li
              key={fileId}
              className="flex min-w-0 items-center gap-2 text-sm"
            >
              {file ? (
                <a
                  href={attachmentDownloadUrl(file)}
                  download={name}
                  target="_self"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    downloadAttachment(file);
                  }}
                  title={name}
                  className="min-w-0 flex-1 truncate text-accent underline"
                >
                  {name}
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-muted">
                  {name}
                </span>
              )}
              <button
                type="button"
                disabled={busy}
                aria-label={t("attachments.remove", { name })}
                title={t("attachments.remove", { name })}
                onClick={() =>
                  onChange(value.filter((entry) => entry !== fileId))
                }
                className="shrink-0 rounded-sm px-1 text-danger enabled:hover:bg-danger-soft disabled:opacity-50"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <input
        id={id}
        aria-label={field.name}
        type="file"
        multiple
        disabled={busy}
        className="mt-2 block max-w-full cursor-pointer text-xs text-muted file:mr-2 file:cursor-pointer file:rounded-sm file:border file:border-shell file:bg-surface file:px-2 file:py-1 file:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (!files.length) return;
          if (
            warning === "show" &&
            files.some((file) => file.size >= largeAttachmentWarningBytes)
          ) {
            setRemember(false);
            setSelection(files);
          } else upload(files);
        }}
      />
      {state.busy && state.target === id && (
        <p role="status" className="mt-1 text-xs text-muted">
          {t("attachments.uploading")}
        </p>
      )}
      {state.error && state.target === id && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {t("attachments.uploadFailed")}
        </p>
      )}
      {selection && (
        <Modal
          size="small"
          title={t("attachments.largeTitle")}
          onClose={() => setSelection(null)}
        >
          <p className="text-sm">{t("attachments.largeDescription")}</p>
          <ul className="mt-3 max-h-40 overflow-y-auto text-sm text-muted">
            {selection
              .filter((file) => file.size >= largeAttachmentWarningBytes)
              .map((file, index) => (
                <li key={index} className="wrap-anywhere">
                  {file.name}
                </li>
              ))}
          </ul>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="accent-accent"
            />
            {t("attachments.dontWarnAgain")}
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSelection(null)}
              className="rounded-md border border-shell px-3 py-2 text-sm hover:bg-control-hover"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                if (remember) setWarning("hide");
                const files = selection;
                setSelection(null);
                upload(files);
              }}
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface hover:bg-accent-hover"
            >
              {t("attachments.continue")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
