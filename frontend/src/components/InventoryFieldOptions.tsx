import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";
import { type SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import { useInventoryDraft, useDraftEditorLock } from "./InventoryDraftContext";
import type { InventoryFieldOption } from "../types/inventoryField";

/** Define properties for selectable inventory field options. */
interface InventoryFieldOptionsProps {
  fieldId: string;
  options: InventoryFieldOption[];
}

/**
 * Render selectable field options and their management controls.
 * @param fieldId The ID of the inventory field.
 * @param options The list of selectable options for the inventory field.
 */
export function InventoryFieldOptions({
  fieldId,
  options,
}: InventoryFieldOptionsProps) {
  const { t } = useTranslation();
  const [deletingOption, setDeletingOption] =
    useState<InventoryFieldOption | null>(null);
  const [newOptionName, setNewOptionName] = useState("");
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [editingOptionName, setEditingOptionName] = useState("");
  const {
    addOption: addDraftOption,
    renameOption,
    removeOption: removeDraftOption,
    disabled: isMutating,
  } = useInventoryDraft();
  useDraftEditorLock(
    `options-${fieldId}`,
    Boolean(editingOptionId || newOptionName.trim() || deletingOption),
  );

  /**
   * Add an option to the local field draft.
   * @param event The option form submission event.
   */
  function addOption(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    addDraftOption(fieldId, newOptionName.trim());
    setNewOptionName("");
  }

  /**
   * Apply an option rename to the local draft.
   * @param event The rename form submission event.
   * @param optionId The option being renamed.
   */
  function saveOption(
    event: SyntheticEvent<HTMLFormElement>,
    optionId: string,
  ) {
    event.preventDefault();
    renameOption(fieldId, optionId, editingOptionName.trim());
    setEditingOptionId(null);
  }

  /**
   * Ask for confirmation before removing an option.
   * @param option The option selected for deletion.
   */
  function removeOption(option: InventoryFieldOption) {
    setDeletingOption(option);
  }

  return (
    <section className="mt-3 max-w-2xl border-t border-shell pt-3">
      <h3 className="text-sm font-medium">{t("fields.form.options")}</h3>
      <ul className="mt-2 space-y-2">
        {options.map((option) => (
          <li key={option.id}>
            {editingOptionId === option.id ? (
              <form
                className="flex gap-2"
                onSubmit={(event) => saveOption(event, option.id)}
              >
                <input
                  aria-label={t("fields.optionName")}
                  disabled={isMutating}
                  className="w-full rounded-lg border border-shell bg-surface px-3 py-2 text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  maxLength={255}
                  onChange={(event) => setEditingOptionName(event.target.value)}
                  required
                  value={editingOptionName}
                />
                <button
                  className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-surface disabled:opacity-50"
                  disabled={isMutating || !editingOptionName.trim()}
                  type="submit"
                >
                  {t("common.actions.save")}
                </button>
                <button
                  className="rounded-lg border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover enabled:hover:border-accent/50"
                  disabled={isMutating}
                  onClick={() => setEditingOptionId(null)}
                  type="button"
                >
                  {t("common.actions.cancel")}
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-muted px-3 py-2">
                <span className="min-w-0 truncate text-sm">{option.name}</span>
                <div className="flex gap-2">
                  <button
                    className="rounded-md px-2 py-1 text-sm font-medium text-muted enabled:hover:bg-control-hover enabled:hover:border-accent/50 hover:text-foreground"
                    disabled={isMutating}
                    onClick={() => {
                      setEditingOptionId(option.id);
                      setEditingOptionName(option.name);
                    }}
                    type="button"
                  >
                    {t("common.actions.edit")}
                  </button>
                  <button
                    className="rounded-md px-2 py-1 text-sm font-medium text-danger enabled:hover:bg-danger/25 disabled:opacity-50"
                    disabled={isMutating}
                    onClick={() => removeOption(option)}
                    type="button"
                  >
                    {t("common.actions.delete")}
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={addOption}>
        <input
          aria-label={t("fields.newOptionName")}
          disabled={isMutating}
          className="w-full rounded-lg border border-shell bg-surface px-3 py-2 text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          maxLength={255}
          onChange={(event) => setNewOptionName(event.target.value)}
          placeholder={t("fields.newOption")}
          required
          value={newOptionName}
        />
        <button
          className="rounded-lg border border-shell px-3 py-2 text-sm font-semibold enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:opacity-50"
          disabled={isMutating || !newOptionName.trim()}
          type="submit"
        >
          {t("common.actions.add")}
        </button>
      </form>
      {deletingOption && (
        <DeleteConfirmationDialog
          title={t("fields.titles.deleteOption")}
          message={t("fields.confirmDelete", { name: deletingOption.name })}
          isPending={false}
          error={null}
          onClose={() => setDeletingOption(null)}
          onConfirm={() => {
            removeDraftOption(fieldId, deletingOption.id);
            setDeletingOption(null);
          }}
        />
      )}
    </section>
  );
}
