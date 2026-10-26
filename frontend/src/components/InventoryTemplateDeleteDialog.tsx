import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useDeleteInventoryTemplate } from "../hooks/useInventoryTemplates";
import { getInventoryTemplate } from "../services/inventoryTemplates";
import { ApiError } from "../services/api";
import type { InventoryTemplate } from "../types/inventoryTemplate";
import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";

/**
 * Delete only the displayed revision, requiring a fresh explicit confirmation after conflicts.
 * @param props The selected list snapshot and dismissal callback.
 * @returns A themed confirmation with guarded requests and explicit target reload.
 */
export function InventoryTemplateDeleteDialog({
  initial,
  onClose,
}: {
  initial: InventoryTemplate;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(initial);
  const pending = useRef(false);
  const remove = useDeleteInventoryTemplate();
  const reload = useMutation({
    mutationFn: () => getInventoryTemplate(initial.id),
    retry: false,
  });
  const busy = remove.isPending || reload.isPending;
  const conflict =
    remove.error instanceof ApiError &&
    ["inventory_template_conflict", "inventory_template_not_found"].includes(
      remove.error.code ?? "",
    );

  // The confirmed target must stay mounted while deletion or explicit recovery is pending.
  function close() {
    if (!pending.current) onClose();
  }
  function confirm() {
    if (pending.current || conflict) return;
    pending.current = true;
    remove.mutate(
      { id: target.id, revision: target.revision },
      {
        onSuccess: onClose,
        onSettled: () => {
          pending.current = false;
        },
      },
    );
  }
  // A changed name/revision is shown first; reload never automatically repeats deletion.
  function reloadTarget() {
    if (pending.current) return;
    pending.current = true;
    reload.mutate(undefined, {
      onSuccess: (template) => {
        setTarget(template);
        remove.reset();
      },
      onSettled: () => {
        pending.current = false;
      },
    });
  }

  return (
    <DeleteConfirmationDialog
      title={t("templates.deleteTitle")}
      message={t("templates.confirmDelete", { name: target.name })}
      isPending={busy}
      onClose={close}
      onConfirm={confirm}
      confirmDisabled={conflict}
      error={
        remove.error
          ? t(conflict ? "templates.deleteConflict" : "templates.deleteFailed")
          : null
      }
    >
      {conflict && (
        <button
          type="button"
          onClick={reloadTarget}
          disabled={busy}
          className="rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
        >
          {t("templates.reloadTarget")}
        </button>
      )}
      {reload.error && (
        <p role="alert" className="text-sm text-danger">
          {t("templates.detailFailed")}
        </p>
      )}
    </DeleteConfirmationDialog>
  );
}
