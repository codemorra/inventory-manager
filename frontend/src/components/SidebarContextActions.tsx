import { type SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  useDeleteInventory,
  useUpdateInventory,
} from "../hooks/useInventories";
import { useGroupMutations } from "../hooks/useInventoryGroups";
import type { Inventory } from "../types/inventory";
import type { InventoryGroup } from "../services/inventoryGroups";
import { ContextMenu } from "./ContextMenu";
import { Modal } from "./Modal";

// Identify the selected sidebar object and the context menu position.
export type SidebarContextTarget = {
  x: number;
  y: number;
  source: HTMLElement;
} & (
  | { kind: "inventory"; entry: Inventory }
  | { kind: "group"; entry: InventoryGroup }
);

// Define callbacks for sidebar context actions.
interface SidebarContextActionsProps {
  target: SidebarContextTarget;
  onClose: () => void;
  onOpenDialog: () => void;
}

/**
 * Render context actions and their edit or deletion dialogs.
 * @param target The selected inventory or group.
 * @param onClose Callback used to close the action flow.
 * @param onOpenDialog Callback used to dismiss mobile navigation before a dialog opens.
 * @returns A context menu or the selected action dialog.
 */
export function SidebarContextActions({
  target,
  onClose,
  onOpenDialog,
}: SidebarContextActionsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [stage, setStage] = useState<"menu" | "edit" | "delete">("menu");
  const [name, setName] = useState(target.entry.name);
  const [description, setDescription] = useState(
    target.kind === "inventory" ? (target.entry.description ?? "") : "",
  );
  const updateInventory = useUpdateInventory();
  const deleteInventory = useDeleteInventory();
  const groups = useGroupMutations();
  const busy =
    updateInventory.isPending ||
    deleteInventory.isPending ||
    groups.update.isPending ||
    groups.remove.isPending;
  const error =
    updateInventory.error ??
    deleteInventory.error ??
    groups.update.error ??
    groups.remove.error;
  const group = target.kind === "group";
  const inputClass =
    "mt-1.5 w-full rounded-md border border-shell bg-surface px-3 py-2 text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

  // Close the action flow and return focus to the source when it still exists.
  function close() {
    if (busy) return;
    if (target.source.isConnected) target.source.focus();
    onClose();
  }

  /**
   * Transition from the menu into a dialog outside mobile navigation.
   * @param nextStage The action selected in the menu.
   */
  function openDialog(nextStage: "edit" | "delete") {
    onOpenDialog();
    setStage(nextStage);
  }

  /**
   * Persist the edited group name or inventory metadata.
   * @param event The form submission event.
   */
  function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (group)
      groups.update.mutate(
        { id: target.entry.id, name: name.trim() },
        { onSuccess: onClose },
      );
    else
      updateInventory.mutate(
        {
          inventoryId: target.entry.id,
          data: { name: name.trim(), description: description.trim() || null },
        },
        { onSuccess: onClose },
      );
  }

  // Delete only after confirmation and leave a deleted inventory's page.
  function confirmDelete() {
    if (group) groups.remove.mutate(target.entry.id, { onSuccess: onClose });
    else
      deleteInventory.mutate(target.entry.id, {
        onSuccess: () => {
          if (location.pathname.startsWith(`/inventories/${target.entry.id}/`))
            navigate("/");
          onClose();
        },
      });
  }

  if (stage === "menu")
    return (
      <ContextMenu
        x={target.x}
        y={target.y}
        label={t("contextMenu.label", { name: target.entry.name })}
        onClose={close}
        actions={[
          {
            label: group ? t("contextMenu.rename") : t("common.actions.edit"),
            onSelect: () => openDialog("edit"),
          },
          {
            label: t("common.actions.delete"),
            danger: true,
            onSelect: () => openDialog("delete"),
          },
        ]}
      />
    );

  return (
    <Modal
      size={group || stage === "delete" ? "small" : "medium"}
      onClose={close}
      title={
        stage === "delete"
          ? t(group ? "contextMenu.deleteGroup" : "contextMenu.deleteInventory")
          : group
            ? t("groups.rename", { name: target.entry.name })
            : t("inventories.titles.edit")
      }
    >
      {stage === "edit" ? (
        <form className="space-y-4" onSubmit={save}>
          <label className="block text-sm font-medium">
            {t(group ? "groups.name" : "common.fields.name")}
            <input
              autoFocus
              className={inputClass}
              maxLength={255}
              required
              disabled={busy}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {!group && (
            <label className="block text-sm font-medium">
              {t("common.fields.description")}
              <textarea
                className={`${inputClass} min-h-24 resize-y`}
                disabled={busy}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
          )}
          {error && (
            <p
              className="rounded-md bg-danger-soft p-3 text-sm text-danger"
              role="alert"
            >
              {t("contextMenu.error")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              className="rounded-md border border-shell px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50"
              disabled={busy}
              onClick={close}
              type="button"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface hover:bg-accent-hover disabled:opacity-50"
              disabled={busy || !name.trim()}
              type="submit"
            >
              {t(busy ? "common.actions.saving" : "common.actions.saveChanges")}
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <p className="wrap-break-word text-sm leading-relaxed">
            {t(group ? "groups.confirmDelete" : "inventories.confirmDelete", {
              name: target.entry.name,
            })}
          </p>
          {error && (
            <p
              className="rounded-md bg-danger-soft p-3 text-sm text-danger"
              role="alert"
            >
              {t("contextMenu.error")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              autoFocus
              className="rounded-md border border-shell px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50"
              disabled={busy}
              onClick={close}
              type="button"
            >
              {t("common.actions.cancel")}
            </button>
            <button
              className="rounded-md bg-danger-soft px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/20 disabled:opacity-50"
              disabled={busy}
              onClick={confirmDelete}
              type="button"
            >
              {t(busy ? "common.actions.deleting" : "common.actions.delete")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
