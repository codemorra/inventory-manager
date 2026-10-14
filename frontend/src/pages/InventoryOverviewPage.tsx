import { useTranslation } from "react-i18next";

import { InventoryTable } from "../components/InventoryTable";
import { useInventories } from "../hooks/useInventories";
import { ApiError } from "../services/api";

// Render the inventory overview interface.
export function InventoryOverviewPage() {
  const { t } = useTranslation();
  const { data: inventories, error, isError, isPending } = useInventories();

  return (
    <div>
      <div className="min-w-0 w-full">
        <header className="mb-8">
          <p className="mb-2 text-sm font-semibold uppercase tracking-wider text-accent">
            {t("app.name")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-heading sm:text-4xl">
            {t("inventories.title")}
          </h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-muted">
            {t("inventories.description")}
          </p>
        </header>

        {isPending && (
          <p
            className="rounded-xl border border-shell bg-surface p-5 text-muted shadow-soft"
            role="status"
          >
            {t("inventories.loading")}
          </p>
        )}

        {isError && (
          <p
            className="rounded-xl border border-danger/30 bg-danger-soft px-5 py-4 text-danger"
            role="alert"
          >
            {error instanceof ApiError
              ? error.message
              : t("inventories.errors.load")}
          </p>
        )}

        {!isPending && !isError && inventories?.length === 0 && (
          <section className="rounded-2xl border border-dashed border-shell bg-surface/70 px-6 py-14 text-center shadow-soft">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent">
              <svg
                aria-hidden="true"
                className="size-7"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.7"
                viewBox="0 0 24 24"
              >
                <path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" />
                <path d="M4 7.5V17l8 4 8-4V7.5M12 12v9" />
              </svg>
            </span>
            <h2 className="mt-5 text-lg font-semibold">
              {t("inventories.empty")}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
              {t("inventories.emptyDescription")}
            </p>
          </section>
        )}

        {!isPending && !isError && inventories && inventories.length > 0 && (
          <InventoryTable inventories={inventories} />
        )}
      </div>
    </div>
  );
}
