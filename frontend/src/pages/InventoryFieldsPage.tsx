import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useInventoryFields } from "../hooks/useInventoryFields";
import { ApiError } from "../services/api";
import { InventoryFieldCard } from "../components/InventoryFieldCard";
import { InventoryFieldCreateForm } from "../components/InventoryFieldCreateForm";
import { InventorySectionNavigation } from "../components/InventorySectionNavigation";

// Render the inventory field overview and management interface.
export function InventoryFieldsPage() {
  const { t } = useTranslation();
  const { inventoryId } = useParams();
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
      <div className="mx-auto max-w-5xl">
        <InventorySectionNavigation inventoryId={inventoryId} />

        <header className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-accent">
              {t("navigation.inventories")}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-heading sm:text-4xl">
              {t("fields.title")}
            </h1>
            <p className="mt-3 max-w-2xl leading-relaxed text-muted">
              {t("fields.description")}
            </p>
          </div>
          <div className="shrink-0">
            <InventoryFieldCreateForm inventoryId={inventoryId} />
          </div>
        </header>

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
            <ul className="grid gap-4 md:grid-cols-2">
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
