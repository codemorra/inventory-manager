import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useInventoryFields } from "../hooks/useInventoryFields";
import { useInventories } from "../hooks/useInventories";
import { ApiError } from "../services/api";
import { InventoryFieldCard } from "../components/InventoryFieldCard";
import { InventoryFieldCreateForm } from "../components/InventoryFieldCreateForm";
import { InventorySectionNavigation } from "../components/InventorySectionNavigation";

// Render the inventory field overview and management interface.
export function InventoryFieldsPage() {
  const { t } = useTranslation();
  const { inventoryId } = useParams();
  const { data: inventories } = useInventories();
  const inventory = inventories?.find((entry) => entry.id === inventoryId);
  const {
    data: inventoryFields,
    error,
    isError,
    isPending,
  } = useInventoryFields(inventoryId ?? "");

  if (!inventoryId) {
    return null;
  }

  return (
    <div>
      <div className="min-w-0 w-full">
        <header className="mb-5">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-accent">
              {t("navigation.inventories")}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-heading sm:text-3xl">
              {inventory?.name ?? t("fields.title")}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              {inventory?.description || t("fields.description")}
            </p>
          </div>
        </header>

        <InventorySectionNavigation inventoryId={inventoryId} />

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-shell pb-4">
          <h2 className="text-sm font-semibold text-heading">
            {t("fields.title")}
          </h2>
          <InventoryFieldCreateForm inventoryId={inventoryId} />
        </div>

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
