import { useTranslation } from "react-i18next";

import { useInventoryFields } from "../hooks/useInventoryFields";
import { ApiError } from "../services/api";
import { InventoryFieldCard } from "./InventoryFieldCard";
import { InventoryFieldCreateForm } from "./InventoryFieldCreateForm";
import { InventoryToolbar } from "./InventoryToolbar";

// Define the inventory whose fields are being configured.
interface InventoryFieldsPanelProps {
  inventoryId: string;
}

/**
 * Render field configuration inside the inventory editor.
 * @param inventoryId The inventory identifier.
 * @returns Field actions, loading feedback, and field definitions.
 */
export function InventoryFieldsPanel({
  inventoryId,
}: InventoryFieldsPanelProps) {
  const { t } = useTranslation();
  const {
    data: inventoryFields,
    error,
    isError,
    isPending,
  } = useInventoryFields(inventoryId);

  return (
    <div>
      <div className="min-w-0 w-full">
        <InventoryToolbar
          actions={<InventoryFieldCreateForm inventoryId={inventoryId} />}
        >
          <h2 className="text-sm font-semibold text-heading">
            {t("fields.title")}
          </h2>
        </InventoryToolbar>

        {isPending && (
          <p
            className="rounded-xl border border-shell bg-surface p-5 text-muted shadow-soft"
            role="status"
          >
            {t("fields.loading")}
          </p>
        )}

        {isError && (
          <p
            className="rounded-xl border border-danger/30 bg-danger-soft px-5 py-4 text-danger"
            role="alert"
          >
            {error instanceof ApiError
              ? error.message
              : t("fields.errors.load")}
          </p>
        )}

        {!isPending && !isError && inventoryFields?.length === 0 && (
          <section className="rounded-2xl border border-dashed border-shell bg-surface/70 px-6 py-12 text-center shadow-soft">
            <h2 className="text-lg font-semibold">{t("fields.empty")}</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
              {t("fields.emptyDescription")}
            </p>
          </section>
        )}

        {!isPending &&
          !isError &&
          inventoryFields &&
          inventoryFields.length > 0 && (
            <ul className="divide-y divide-shell overflow-hidden rounded-md border border-shell">
              {inventoryFields.map((inventoryField) => (
                <li key={inventoryField.id}>
                  <InventoryFieldCard
                    inventoryField={inventoryField}
                    inventoryId={inventoryId}
                  />
                </li>
              ))}
            </ul>
          )}
      </div>
    </div>
  );
}
