import { useId, useRef, useState, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import { useSaveInventoryTemplate } from "../hooks/useInventoryTemplates";
import { ApiError } from "../services/api";
import { Modal } from "./Modal";

// The source revision stays fixed for the lifetime of this dialog.
interface SaveInventoryTemplateDialogProps {
  inventoryId: string;
  revision: number;
  onClose: () => void;
  onSaved: () => void;
  onConflict: () => void;
}

/**
 * Name and save a blueprint from the inventory editor's unchanged saved baseline.
 * @param props Source identity, captured revision, and session callbacks.
 * @returns The template metadata form, retaining inputs after failed saves.
 */
export function SaveInventoryTemplateDialog(
  props: SaveInventoryTemplateDialogProps,
) {
  const { t } = useTranslation();
  const id = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const saving = useRef(false);
  const create = useSaveInventoryTemplate();
  const conflict =
    create.error instanceof ApiError &&
    ["inventory_configuration_conflict", "inventory_not_found"].includes(
      create.error.code ?? "",
    );
  const inputClass =
    "mt-1.5 w-full rounded-md border border-shell bg-surface px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50";

  // Keep the pending request's source and callbacks mounted until the write finishes.
  function close() {
    if (!saving.current) props.onClose();
  }

  /**
   * Submit only source identity and revision, never item data or a local field draft.
   * @param event The metadata form submission.
   */
  function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || conflict || !name.trim()) return;
    saving.current = true;
    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
        source_inventory_id: props.inventoryId,
        expected_configuration_revision: props.revision,
      },
      {
        onSuccess: props.onSaved,
        onError: (error) => {
          if (
            error instanceof ApiError &&
            [
              "inventory_configuration_conflict",
              "inventory_not_found",
            ].includes(error.code ?? "")
          )
            props.onConflict();
        },
        onSettled: () => {
          saving.current = false;
        },
      },
    );
  }

  return (
    <Modal title={t("templates.saveTitle")} onClose={close} size="medium">
      <form onSubmit={save} className="space-y-4">
        <label className="block text-sm font-medium" htmlFor={`${id}-name`}>
          {t("common.fields.name")}
          <input
            autoFocus
            id={`${id}-name`}
            required
            maxLength={255}
            className={inputClass}
            value={name}
            disabled={create.isPending}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label
          className="block text-sm font-medium"
          htmlFor={`${id}-description`}
        >
          {t("common.fields.description")}
          <textarea
            id={`${id}-description`}
            className={`${inputClass} min-h-24 resize-y`}
            value={description}
            disabled={create.isPending}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <p className="text-sm text-muted">{t("templates.structureOnly")}</p>
        {create.error && (
          <p
            role="alert"
            className="rounded-md bg-danger-soft p-3 text-sm text-danger"
          >
            {conflict
              ? t("templates.sourceConflict")
              : t("templates.saveFailed")}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 border-t border-shell pt-4">
          <button
            type="button"
            disabled={create.isPending}
            onClick={close}
            className="rounded-md border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover disabled:opacity-50"
          >
            {t("common.actions.cancel")}
          </button>
          <button
            type="submit"
            disabled={create.isPending || conflict || !name.trim()}
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface enabled:hover:bg-accent-hover disabled:opacity-50"
          >
            {create.isPending
              ? t("common.actions.saving")
              : t("templates.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
