import { Link, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { InventoryItemCreateForm } from "../components/InventoryItemCreateForm";
import { InventoryItemList } from "../components/InventoryItemList";
import { InventoryEditDialog } from "../components/InventoryEditDialog";
import { InventoryTableControls } from "../components/InventoryTableControls";
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
  const hasTable = !isPending && !isError && !!fieldQuery.data?.length;

  /**
   * Open the inventory editor while retaining other URL state.
   */
  function openInventoryEditor() {
    const next = new URLSearchParams(searchParams);
    next.set("edit", "general");
    setSearchParams(next);
  }

  return (
    <div>
      <div className="min-w-0 w-full">
        <header className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2">
          <h1 className="min-w-0 wrap-break-word text-2xl font-semibold tracking-tight text-heading sm:text-3xl">
            {inventory?.name ?? t("items.title")}
          </h1>
          {inventory && (
            <button
              type="button"
              aria-label={t("inventories.settings")}
              title={t("inventories.settings")}
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition enabled:hover:text-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={openInventoryEditor}
            >
              <svg
                aria-hidden="true"
                className="size-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                viewBox="0 0 24 24"
              >
                <path d="M9.5 3h5l.5 2.2 1.4.8 2.2-.7 2.5 4.4-1.6 1.5v1.6l1.6 1.5-2.5 4.4-2.2-.7-1.4.8-.5 2.2h-5L9 18.8 7.6 18l-2.2.7-2.5-4.4 1.6-1.5v-1.6L2.9 9.7l2.5-4.4 2.2.7L9 5.2Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          )}
          {inventory?.description?.trim() && (
            <p className="col-span-full wrap-break-word text-sm leading-relaxed text-muted">
              {inventory.description}
            </p>
          )}
        </header>

        {!hasTable && (
          <div className="mb-4 rounded-md border-b border-shell">
            <InventoryTableControls />
          </div>
        )}

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

        {hasTable && fieldQuery.data && (
          <InventoryItemList
            key={inventoryId}
            inventoryId={inventoryId}
            fields={fieldQuery.data}
            items={itemQuery.data ?? []}
            actions={
              <InventoryItemCreateForm
                fields={fieldQuery.data}
                inventoryId={inventoryId}
                compact
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
