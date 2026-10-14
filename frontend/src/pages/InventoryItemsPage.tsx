import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { InventoryItemCreateForm } from "../components/InventoryItemCreateForm";
import { InventoryItemList } from "../components/InventoryItemList";
import { InventoryEditDialog } from "../components/InventoryEditDialog";
import { useInventoryFields } from "../hooks/useInventoryFields";
import { useInventoryItems } from "../hooks/useInventoryItems";
import { useInventories } from "../hooks/useInventories";
import { ApiError } from "../services/api";

// Render the inventory item overview and creation interface.
export function InventoryItemsPage() {
  const { t } = useTranslation();
  const { inventoryId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const itemQuery = useInventoryItems(inventoryId ?? "");
  const fieldQuery = useInventoryFields(inventoryId ?? "");
  const { data: inventories } = useInventories();
  const inventory = inventories?.find((entry) => entry.id === inventoryId);

  if (!inventoryId) {
    return null;
  }

  const isPending = itemQuery.isPending || fieldQuery.isPending;
  const error = itemQuery.error ?? fieldQuery.error;
  const isError = itemQuery.isError || fieldQuery.isError;

  return (
    <div>
      <div className="min-w-0 w-full">
        <header className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2">
          <h1 className="min-w-0 wrap-break-word text-2xl font-semibold tracking-tight text-heading sm:text-3xl">
            {inventory?.name ?? t("items.title")}
          </h1>
          {inventory && (
            <button
              className="shrink-0 rounded-md border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover enabled:hover:border-accent/50"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.set("edit", "general");
                setSearchParams(next);
              }}
              type="button"
            >
              {t("inventories.titles.edit")}
            </button>
          )}
          {inventory?.description?.trim() && (
            <p className="col-span-full wrap-break-word text-sm leading-relaxed text-muted">
              {inventory.description}
            </p>
          )}
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
                to={`/inventories/${inventoryId}/items?edit=fields`}
              >
                {t("items.noFields.action")}
              </Link>
            </div>
          )}

        {!isPending &&
          !isError &&
          fieldQuery.data &&
          fieldQuery.data.length > 0 && (
            <InventoryItemList
              key={inventoryId}
              fields={fieldQuery.data}
              items={itemQuery.data ?? []}
              actions={
                <InventoryItemCreateForm
                  fields={fieldQuery.data}
                  inventoryId={inventoryId}
                />
              }
            />
          )}
      </div>
      {inventory &&
        ["general", "fields"].includes(searchParams.get("edit") ?? "") && (
          <InventoryEditDialog
            key={inventory.id}
            inventory={inventory}
            initialSection={
              searchParams.get("edit") === "fields" ? "fields" : "general"
            }
            onClose={() => {
              const next = new URLSearchParams(searchParams);
              next.delete("edit");
              setSearchParams(next, { replace: true });
            }}
          />
        )}
    </div>
  );
}
