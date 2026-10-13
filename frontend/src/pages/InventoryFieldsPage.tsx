import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useInventoryFields } from "../hooks/useInventoryFields";
import { ApiError } from "../services/api";
import { InventoryFieldCard } from "../components/InventoryFieldCard";
import { InventoryFieldCreateForm } from "../components/InventoryFieldCreateForm";

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
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <Link
            className="text-sm font-medium text-blue-700 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
            to="/"
          >
            {t("fields.back")}
          </Link>

          <h1 className="mt-4 text-3xl font-semibold">{t("fields.title")}</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-400">
            {t("fields.description")}
          </p>
        </header>

        <div className="mb-6">
          <InventoryFieldCreateForm inventoryId={inventoryId} />
        </div>

        {isPending && (
          <p className="text-slate-600 dark:text-slate-400" role="status">
            {t("fields.loading")}
          </p>
        )}

        {isError && (
          <p
            className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            role="alert"
          >
            {error instanceof ApiError
              ? error.message
              : t("fields.errors.load")}
          </p>
        )}

        {!isPending && !isError && inventoryFields?.length === 0 && (
          <p className="text-slate-600 dark:text-slate-400">
            {t("fields.empty")}
          </p>
        )}

        {!isPending &&
          !isError &&
          inventoryFields &&
          inventoryFields.length > 0 && (
            <ul className="space-y-3">
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
