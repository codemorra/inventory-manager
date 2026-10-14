import { type SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGroupMutations } from "../hooks/useInventoryGroups";
import { Modal } from "./Modal";

// Define properties for the group creation dialog.
interface GroupCreateDialogProps {
  onClose: () => void;
}

/**
 * Render a name-only form for creating an inventory group.
 * @param onClose Callback invoked after creation or dismissal.
 * @returns The group creation dialog.
 */
export function GroupCreateDialog({ onClose }: GroupCreateDialogProps) {
  const { t } = useTranslation();
  const { create } = useGroupMutations();
  const [name, setName] = useState("");

  /**
   * Create the group and close the dialog after the sidebar refreshes.
   * @param event The form submission event.
   */
  function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate(name.trim(), { onSuccess: onClose });
  }

  return (
    <Modal
      onClose={() => {
        if (!create.isPending) onClose();
      }}
      title={t("groups.new")}
    >
      <form className="space-y-5" onSubmit={submit}>
        <label className="block text-sm font-medium">
          {t("groups.name")}
          <input
            autoFocus
            className="mt-1.5 w-full rounded-md border border-shell bg-surface px-3 py-2 text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            maxLength={255}
            required
            disabled={create.isPending}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {create.error && (
          <p
            className="rounded-md bg-danger-soft p-3 text-sm text-danger"
            role="alert"
          >
            {t("groups.error")}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="rounded-md border border-shell px-3 py-2 text-sm font-medium hover:bg-surface-hover disabled:opacity-50"
            disabled={create.isPending}
            onClick={onClose}
            type="button"
          >
            {t("common.actions.cancel")}
          </button>
          <button
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface hover:bg-accent-hover disabled:opacity-50"
            disabled={create.isPending || !name.trim()}
            type="submit"
          >
            {create.isPending ? t("groups.creating") : t("groups.create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
