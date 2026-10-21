import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";

// Define the target description and state of a confirmed deletion.
interface DeleteConfirmationDialogProps {
  title: string;
  message: string;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  children?: ReactNode;
}

/**
 * Confirm deletion without allowing dismissal during an active request.
 * @param title The dialog heading identifying the object type.
 * @param message The confirmation text identifying the selected object.
 * @param isPending Whether deletion is still being processed.
 * @param error The localized error message, if deletion failed.
 * @param onClose Callback used to cancel or dismiss the confirmation.
 * @param onConfirm Callback used to delete the selected object.
 * @param confirmDisabled Whether a stale target must be reloaded before confirmation.
 * @param children Optional conflict recovery controls.
 * @returns A themed confirmation dialog with cancel and delete actions.
 */
export function DeleteConfirmationDialog({
  title,
  message,
  isPending,
  error,
  onClose,
  onConfirm,
  confirmDisabled = false,
  children,
}: DeleteConfirmationDialogProps) {
  const { t } = useTranslation();
  const [trigger] = useState(() => document.activeElement);
  useEffect(() => {
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, [trigger]);

  // Keep the confirmation visible until the request settles.
  function close() {
    if (!isPending) onClose();
  }

  return (
    <Modal size="small" title={title} onClose={close}>
      <div className="space-y-4">
        <p className="wrap-break-word text-sm leading-relaxed">{message}</p>
        {error && (
          <p
            className="rounded-md bg-danger-soft p-3 text-sm text-danger"
            role="alert"
          >
            {error}
          </p>
        )}
        {children}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            autoFocus
            className="rounded-md border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:opacity-50"
            disabled={isPending}
            onClick={close}
            type="button"
          >
            {t("common.actions.cancel")}
          </button>
          <button
            className="rounded-md bg-danger-soft px-3 py-2 text-sm font-semibold text-danger enabled:hover:bg-danger/25 disabled:opacity-50"
            disabled={isPending || confirmDisabled}
            onClick={() => {
              if (!isPending && !confirmDisabled) onConfirm();
            }}
            type="button"
          >
            {t(isPending ? "common.actions.deleting" : "common.actions.delete")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
