import { InventoryExportDialog } from "./InventoryExportDialog";
import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";
import { type SyntheticEvent, useContext, useState } from "react";
import { TableEditSessionContext } from "./tableEditSession";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useDeleteInventory } from "../hooks/useInventories";
import { InventoryEditDialog } from "./InventoryEditDialog";
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
 * Render matching symbols for sidebar editing, export and deletion actions.
 * @param action The menu action represented by the symbol.
 * @returns A decorative icon inheriting the menu action's color.
 */
function SidebarActionIcon({
  action,
}: {
  action: "edit" | "export" | "delete";
}) {
  return (
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
      {action === "edit" ? (
        <path d="m16 3 5 5L8 21H3v-5L16 3Z" />
      ) : action === "export" ? (
        <>
          <path d="M14 3H5v18h14v-4M14 3v5h5l-5-5Z" />
          <path d="M11 12h10m-3-3 3 3-3 3" />
        </>
      ) : (
        <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" />
      )}
    </svg>
  );
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
  const { inventoryId: editingInventoryId, configurationInventoryId } =
    useContext(TableEditSessionContext);
  const navigate = useNavigate();
  const location = useLocation();
  const [stage, setStage] = useState<"menu" | "edit" | "delete" | "export">(
    "menu",
  );
  const [name, setName] = useState(target.entry.name);
  const deleteInventory = useDeleteInventory();
  const groups = useGroupMutations();
  const busy =
    deleteInventory.isPending ||
    groups.update.isPending ||
    groups.remove.isPending;
  const error =
    deleteInventory.error ?? groups.update.error ?? groups.remove.error;
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
  function openDialog(nextStage: "edit" | "delete" | "export") {
    onOpenDialog();
    setStage(nextStage);
  }

  /**
   * Persist the edited group name.
   * @param event The form submission event.
   */
  function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (group)
      groups.update.mutate(
        { id: target.entry.id, name: name.trim() },
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
            icon: <SidebarActionIcon action="edit" />,
            disabled: Boolean(editingInventoryId),
            onSelect: () => openDialog("edit"),
          },
          ...(group
            ? []
            : [
                {
                  label: t("archives.export"),
                  icon: <SidebarActionIcon action="export" />,
                  disabled: Boolean(
                    editingInventoryId || configurationInventoryId,
                  ),
                  title:
                    editingInventoryId || configurationInventoryId
                      ? t("archives.saveFirst")
                      : undefined,
                  onSelect: () => openDialog("export"),
                },
              ]),
          {
            label: t("common.actions.delete"),
            icon: <SidebarActionIcon action="delete" />,
            disabled: Boolean(editingInventoryId),
            danger: true,
            onSelect: () => openDialog("delete"),
          },
        ]}
      />
    );

  if (stage === "export" && target.kind === "inventory")
    return <InventoryExportDialog inventory={target.entry} onClose={close} />;

  if (stage === "edit" && target.kind === "inventory") {
    return <InventoryEditDialog inventory={target.entry} onClose={close} />;
  }

  if (stage === "delete") {
    return (
      <DeleteConfirmationDialog
        title={t(
          group ? "contextMenu.deleteGroup" : "contextMenu.deleteInventory",
        )}
        message={t(
          group ? "groups.confirmDelete" : "inventories.confirmDelete",
          { name: target.entry.name },
        )}
        isPending={busy}
        error={error ? t("contextMenu.error") : null}
        onClose={close}
        onConfirm={confirmDelete}
      />
    );
  }

  return (
    <Modal
      size="small"
      onClose={close}
      title={t("groups.rename", { name: target.entry.name })}
    >
      <form className="space-y-4" onSubmit={save}>
        <label className="block text-sm font-medium">
          {t("groups.name")}
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
            className="rounded-md border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:opacity-50"
            disabled={busy}
            onClick={close}
            type="button"
          >
            {t("common.actions.cancel")}
          </button>
          <button
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface enabled:hover:bg-accent-hover disabled:opacity-50"
            disabled={busy || !name.trim()}
            type="submit"
          >
            {t(busy ? "common.actions.saving" : "common.actions.saveChanges")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
