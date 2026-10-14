import { type SyntheticEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUpdateInventory } from "../hooks/useInventories";
import { ApiError } from "../services/api";
import type { Inventory } from "../types/inventory";
import { InventoryFieldsPanel } from "./InventoryFieldsPanel";
import { Modal } from "./Modal";

// Define the shared inventory editor and its initially visible section.
interface InventoryEditDialogProps {
  inventory: Inventory;
  onClose: () => void;
  initialSection?: "general" | "fields";
}

/**
 * Edit inventory metadata and field definitions in one dialog.
 * @param inventory The inventory being edited.
 * @param onClose Callback used to dismiss the editor.
 * @param initialSection The section to open initially.
 * @returns The inventory editor with general and field settings.
 */
export function InventoryEditDialog({
  inventory,
  onClose,
  initialSection = "general",
}: InventoryEditDialogProps) {
  const { t } = useTranslation();
  const formId = useId();
  const [section, setSection] = useState(initialSection);
  const [name, setName] = useState(inventory.name);
  const [description, setDescription] = useState(inventory.description ?? "");
  const update = useUpdateInventory();
  const inputClass =
    "mt-1.5 w-full rounded-md border border-shell bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

  // Keep the editor open while its metadata is being saved.
  function close() {
    if (!update.isPending) onClose();
  }

  /**
   * Save general settings without changing group membership.
   * @param event The form submission event.
   */
  function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    update.mutate(
      {
        inventoryId: inventory.id,
        data: { name: name.trim(), description: description.trim() || null },
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Modal title={t("inventories.titles.edit")} onClose={close}>
      <nav
        aria-label={t("navigation.inventorySections")}
        className="mb-5 flex gap-1 border-b border-shell"
      >
        {(["general", "fields"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            aria-current={section === entry ? "page" : undefined}
            disabled={update.isPending}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${section === entry ? "border-accent bg-accent-soft text-accent" : "border-transparent text-muted hover:bg-surface-hover hover:text-foreground"}`}
            onClick={() => setSection(entry)}
          >
            {t(
              entry === "general"
                ? "inventories.general"
                : "inventories.actions.fields",
            )}
          </button>
        ))}
      </nav>
      {section === "fields" ? (
        <>
          <InventoryFieldsPanel inventoryId={inventory.id} />
          <form id={formId} onSubmit={save} />
        </>
      ) : (
        <form className="space-y-4" id={formId} onSubmit={save}>
          <label className="block text-sm font-medium">
            {t("common.fields.name")}
            <input
              autoFocus
              className={inputClass}
              maxLength={255}
              required
              disabled={update.isPending}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            {t("common.fields.description")}
            <textarea
              className={`${inputClass} min-h-28 resize-y`}
              disabled={update.isPending}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </form>
      )}
      {update.error && (
        <p
          className="rounded-md bg-danger-soft p-3 text-sm text-danger"
          role="alert"
        >
          {update.error instanceof ApiError
            ? update.error.message
            : t("inventories.errors.update")}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2 border-t border-shell pt-4">
        <button
          className="rounded-md border border-shell px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50"
          disabled={update.isPending}
          onClick={close}
          type="button"
        >
          {t("common.actions.cancel")}
        </button>
        <button
          className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface hover:bg-accent-hover disabled:opacity-50"
          disabled={update.isPending || !name.trim()}
          form={formId}
          type="submit"
        >
          {t(
            update.isPending
              ? "common.actions.saving"
              : "common.actions.saveChanges",
          )}
        </button>
      </div>
    </Modal>
  );
}
