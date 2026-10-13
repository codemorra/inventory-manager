import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { InventoryItemCreateForm } from "../components/InventoryItemCreateForm";
import { InventoryItemList } from "../components/InventoryItemList";
import { InventorySectionNavigation } from "../components/InventorySectionNavigation";
import { useInventoryFields } from "../hooks/useInventoryFields";
import { useInventoryItems } from "../hooks/useInventoryItems";
import { ApiError } from "../services/api";

// Render the inventory item overview and creation interface.
export function InventoryItemsPage() {
  const { t } = useTranslation();
  const { inventoryId } = useParams();
  const itemQuery = useInventoryItems(inventoryId ?? "");
  const fieldQuery = useInventoryFields(inventoryId ?? "");

  if (!inventoryId) {
    return null;
  }

  const isPending = itemQuery.isPending || fieldQuery.isPending;
  const error = itemQuery.error ?? fieldQuery.error;
  const isError = itemQuery.isError || fieldQuery.isError;

  return (
    <div>
      <div className="mx-auto max-w-7xl">
        <InventorySectionNavigation inventoryId={inventoryId} />

        <header className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-accent">
              {t("navigation.inventories")}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {t("items.title")}
            </h1>
            <p className="mt-3 max-w-2xl leading-relaxed text-muted">
              {t("items.description")}
            </p>
          </div>
          {!isPending && !isError && fieldQuery.data?.length ? (
            <div className="shrink-0">
              <InventoryItemCreateForm
                fields={fieldQuery.data}
                inventoryId={inventoryId}
              />
            </div>
          ) : null}
        </header>

        {isPending && (
          <p
            className="rounded-xl border border-shell bg-surface p-5 text-muted shadow-soft"
            role="status"
          >
            {t("items.loading")}
          </p>
        )}

        {isError && (
          <p
            className="rounded-xl border border-danger/30 bg-danger-soft px-5 py-4 text-danger"
            role="alert"
          >
            {error instanceof ApiError ? error.message : t("items.errors.load")}
          </p>
        )}

        {!isPending &&
          !isError &&
          fieldQuery.data &&
          fieldQuery.data.length === 0 && (
            <div className="rounded-2xl border border-dashed border-shell bg-surface/70 p-8 text-center shadow-soft">
              <h2 className="font-semibold">{t("items.noFields.title")}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                {t("items.noFields.description")}
              </p>
              <Link
                className="mt-5 inline-flex rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover"
                to={`/inventories/${inventoryId}/fields`}
              >
                {t("items.noFields.action")}
              </Link>
            </div>
          )}

        {!isPending &&
          !isError &&
          fieldQuery.data &&
          fieldQuery.data.length > 0 && (
            <>
              {itemQuery.data?.length ? (
                <InventoryItemList
                  fields={fieldQuery.data}
                  items={itemQuery.data}
                />
              ) : (
                <section className="rounded-2xl border border-dashed border-shell bg-surface/70 px-6 py-12 text-center shadow-soft">
                  <h2 className="text-lg font-semibold">{t("items.empty")}</h2>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
                    {t("items.emptyDescription")}
                  </p>
                </section>
              )}
            </>
          )}
      </div>
    </div>
  );
}
