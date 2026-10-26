import { useContext, useEffect } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";

interface UnsavedTableChangesProps {
  dirty: boolean;
  saving: boolean;
  onDiscard: () => void;
}

/**
 * Guard in-app navigation through the router's blocker instead of browser confirmation dialogs.
 * @param props Unsaved state, pending write state, and explicit discard action.
 * @returns A themed leave confirmation only when navigation has been blocked.
 */
function RouterDraftGuard({
  dirty,
  saving,
  onDiscard,
}: UnsavedTableChangesProps) {
  const { t } = useTranslation();
  const blocker = useBlocker(dirty || saving);
  if (blocker.state !== "blocked") return null;
  return (
    <Modal
      size="small"
      title={t("table.edit.leaveTitle")}
      onClose={() => blocker.reset()}
    >
      <p className="text-sm">
        {t(saving ? "table.edit.waitForSave" : "table.edit.leaveDescription")}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button
          autoFocus
          type="button"
          className="rounded-sm border border-shell px-3 py-2 text-sm hover:bg-control-hover"
          onClick={() => blocker.reset()}
        >
          {t("table.edit.stay")}
        </button>
        <button
          type="button"
          disabled={saving}
          className="rounded-sm bg-danger-soft px-3 py-2 text-sm text-danger enabled:hover:bg-danger/25 disabled:opacity-50"
          onClick={() => {
            onDiscard();
            blocker.proceed();
          }}
        >
          {t("table.edit.discardAndLeave")}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Protect browser reload/close and route changes while preserving ordinary isolated table usage.
 * @param props The unsaved draft and its explicit discard action.
 * @returns The optional router guard; reload/close uses the browser's native unload protection.
 */
export function UnsavedTableChanges(props: UnsavedTableChangesProps) {
  const router = useContext(UNSAFE_DataRouterContext);
  useEffect(() => {
    if (!props.dirty && !props.saving) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [props.dirty, props.saving]);
  return router ? <RouterDraftGuard {...props} /> : null;
}
