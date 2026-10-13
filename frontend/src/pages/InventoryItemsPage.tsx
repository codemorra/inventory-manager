import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { InventoryItemCreateForm } from "../components/InventoryItemCreateForm";
import { InventoryItemList } from "../components/InventoryItemList";
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
        <header className="mb-8">
          <Link
            className="text-sm font-medium text-blue-700 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
            to="/"
          >
            {t("items.back")}
          </Link>
          <h1 className="mt-4 text-3xl font-semibold">{t("items.title")}</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            {t("items.description")}
          </p>
        </header>

        {isPending && (
          <p className="text-slate-600 dark:text-slate-400" role="status">
            {t("items.loading")}
          </p>
        )}

        {isError && (
          <p
            className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            role="alert"
          >
            {error instanceof ApiError ? error.message : t("items.errors.load")}
          </p>
        )}

        {!isPending &&
          !isError &&
          fieldQuery.data &&
          fieldQuery.data.length === 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
              <h2 className="font-semibold">{t("items.noFields.title")}</h2>
              <p className="mt-1 text-sm">{t("items.noFields.description")}</p>
              <Link
                className="mt-3 inline-block text-sm font-medium underline underline-offset-2"
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
              <InventoryItemCreateForm
                fields={fieldQuery.data}
                inventoryId={inventoryId}
              />

              {itemQuery.data?.length ? (
                <InventoryItemList
                  fields={fieldQuery.data}
                  items={itemQuery.data}
                />
              ) : (
                <p className="mt-6 text-slate-600 dark:text-slate-400">
                  {t("items.empty")}
                </p>
              )}
            </>
          )}
      </div>
    </div>
  );
}
