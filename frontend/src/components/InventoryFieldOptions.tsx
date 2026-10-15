import { DeleteConfirmationDialog } from "./DeleteConfirmationDialog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { InventoryFieldOption } from "../types/inventoryField";

// Define locally controlled options within a field editing dialog.
interface InventoryFieldOptionsProps {
  fieldId: string;
  options: InventoryFieldOption[];
  disabled?: boolean;
  onChange: (options: InventoryFieldOption[]) => void;
  onPendingChange?: (pending: boolean) => void;
}

/**
 * Render selectable field options and their management controls.
 * @param fieldId The ID of the inventory field.
 * @param options The list of selectable options for the inventory field.
 * @param disabled Whether option editing is disabled during saving.
 * @param onChange Update options in the local child draft.
 * @param onPendingChange Report unfinished input to prevent accidental field saves.
 * @returns Option controls without nested HTML forms or direct persistence.
 */
export function InventoryFieldOptions({
  fieldId,
  options,
  disabled: isMutating = false,
  onChange,
  onPendingChange,
}: InventoryFieldOptionsProps) {
  const { t } = useTranslation();
  const [deletingOption, setDeletingOption] =
    useState<InventoryFieldOption | null>(null);
  const [newOptionName, setNewOptionName] = useState("");
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [editingOptionName, setEditingOptionName] = useState("");
  const pending = Boolean(
    editingOptionId || newOptionName.trim() || deletingOption,
  );
  useEffect(() => {
    onPendingChange?.(pending);
    return () => onPendingChange?.(false);
  }, [pending, onPendingChange]);

  // Add an option to the child draft; closing the field dialog can still discard it.
  function addOption() {
    if (isMutating || !newOptionName.trim()) return;
    onChange([
      ...options,
      {
        id: crypto.randomUUID(),
        field_id: fieldId,
        name: newOptionName.trim(),
        position: options.length,
        created_at: "",
        updated_at: "",
      },
    ]);
    setNewOptionName("");
  }

  /**
   * Apply an option rename to the local draft.
   * @param optionId The option being renamed.
   */
  function saveOption(optionId: string) {
    if (isMutating || !editingOptionName.trim()) return;
    onChange(
      options.map((option) =>
        option.id === optionId
          ? { ...option, name: editingOptionName.trim() }
          : option,
      ),
    );
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
    <section>
      <h3 className="text-sm font-medium">{t("fields.form.options")}</h3>
      <ul className="mt-2 space-y-2">
        {options.map((option) => (
          <li key={option.id}>
            {editingOptionId === option.id ? (
              <div
                className="flex gap-2"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    event.target instanceof HTMLInputElement
                  ) {
                    event.preventDefault();
                    event.stopPropagation();
                    saveOption(option.id);
                  }
                }}
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
                  type="button"
                  onClick={() => saveOption(option.id)}
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
              </div>
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
      <div
        className="mt-3 flex gap-2"
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            event.target instanceof HTMLInputElement
          ) {
            event.preventDefault();
            event.stopPropagation();
            addOption();
          }
        }}
      >
        <input
          aria-label={t("fields.newOptionName")}
          disabled={isMutating}
          className="w-full rounded-lg border border-shell bg-surface px-3 py-2 text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          maxLength={255}
          onChange={(event) => setNewOptionName(event.target.value)}
          placeholder={t("fields.newOption")}
          value={newOptionName}
        />
        <button
          className="rounded-lg border border-shell px-3 py-2 text-sm font-semibold enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:opacity-50"
          disabled={isMutating || !newOptionName.trim()}
          type="button"
          onClick={addOption}
        >
          {t("common.actions.add")}
        </button>
      </div>
      {deletingOption && (
        <DeleteConfirmationDialog
          title={t("fields.titles.deleteOption")}
          message={t("fields.confirmDelete", { name: deletingOption.name })}
          isPending={false}
          error={null}
          onClose={() => setDeletingOption(null)}
          onConfirm={() => {
            onChange(
              options.filter((option) => option.id !== deletingOption.id),
            );
            setDeletingOption(null);
          }}
        />
      )}
    </section>
  );
}
