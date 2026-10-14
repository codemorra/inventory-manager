import { type SyntheticEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useCreateInventory } from "../hooks/useInventories";
import { ApiError } from "../services/api";
import { Modal } from "./Modal";

// Define properties for the inventory creation control.
interface InventoryCreateFormProps {
  triggerClassName?: string;
  onCreated?: (() => void) | undefined;
}

/**
 * Render a trigger and modal form for creating an inventory.
 * @param triggerClassName Optional classes applied to the modal trigger.
 * @param onCreated Callback used to dismiss navigation after successful creation.
 * @returns The inventory creation control.
 */
export function InventoryCreateForm({
  triggerClassName = "inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover",
  onCreated,
}: InventoryCreateFormProps = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const createInventory = useCreateInventory();

  // Function to close the modal.
  function closeModal() {
    if (!createInventory.isPending) {
      setIsOpen(false);
    }
  }

  /**
   * Create the inventory and navigate to its item page after saving.
   * @param event The form submission event.
   */
  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();

    createInventory.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
      },
      {
        onSuccess: (inventory) => {
          setName("");
          setDescription("");
          setIsOpen(false);
          navigate(`/inventories/${inventory.id}/items`);
          onCreated?.();
        },
      },
    );
  }

  return (
    <>
      <button
        className={triggerClassName}
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <span aria-hidden="true" className="text-lg leading-none">
          +
        </span>
        {t("inventories.actions.new")}
      </button>

      {isOpen && (
        <Modal
          onClose={closeModal}
          title={t("inventories.titles.create")}
          size="medium"
        >
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label
                className="block text-sm font-medium text-foreground"
                htmlFor="inventory-name"
              >
                {t("common.fields.name")}
              </label>
              <input
                autoFocus
                className="mt-1.5 w-full rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                id="inventory-name"
                maxLength={255}
                onChange={(event) => setName(event.target.value)}
                required
                value={name}
              />
            </div>

            <div>
              <label
                className="block text-sm font-medium text-foreground"
                htmlFor="inventory-description"
              >
                {t("common.fields.description")}
              </label>
              <textarea
                className="mt-1.5 min-h-28 w-full resize-y rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                id="inventory-description"
                onChange={(event) => setDescription(event.target.value)}
                value={description}
              />
            </div>

            {createInventory.isError && (
              <p
                className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
                role="alert"
              >
                {createInventory.error instanceof ApiError
                  ? createInventory.error.message
                  : t("inventories.errors.create")}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-3 pt-1">
              <button
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={createInventory.isPending || !name.trim()}
                type="submit"
              >
                {createInventory.isPending
                  ? t("inventories.actions.creating")
                  : t("inventories.actions.create")}
              </button>
              <button
                className="rounded-lg border border-shell px-4 py-2.5 text-sm font-semibold transition hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={createInventory.isPending}
                onClick={closeModal}
                type="button"
              >
                {t("common.actions.cancel")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
