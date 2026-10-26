import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInventoryTemplates } from "../hooks/useInventoryTemplates";
import type { InventoryTemplate } from "../types/inventoryTemplate";
import { InventoryTemplateEditDialog } from "../components/InventoryTemplateEditDialog";
import { InventoryTemplateDeleteDialog } from "../components/InventoryTemplateDeleteDialog";

/** Render template management separately from inventory navigation and item data. */
export function InventoryTemplatesPage() {
  const { t } = useTranslation();
  const query = useInventoryTemplates();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<InventoryTemplate | null>(null);
  const editTrigger = useRef<HTMLButtonElement | null>(null);

  // Restore focus after editing without depending on a possibly refreshed list row.
  function closeEditor() {
    setEditingId(null);
    editTrigger.current?.focus();
  }

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-heading sm:text-4xl">
          {t("templates.title")}
        </h1>
        <p className="mt-2 text-sm text-muted">{t("templates.description")}</p>
      </header>
      {query.isPending && (
        <p role="status" className="text-sm text-muted">
          {t("templates.loading")}
        </p>
      )}
      {query.isError && (
        <div
          role="alert"
          className="mb-4 rounded-md bg-danger-soft p-3 text-sm text-danger"
        >
          {t("templates.managementLoadFailed")}{" "}
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            className="underline disabled:opacity-50"
          >
            {t("common.actions.retry")}
          </button>
        </div>
      )}
      {!query.isPending && !query.isError && !query.data?.length && (
        <div className="rounded-md border border-dashed border-shell bg-surface p-6">
          <h2 className="font-semibold">{t("templates.empty")}</h2>
          <p className="mt-2 text-sm text-muted">{t("templates.emptyHelp")}</p>
        </div>
      )}
      {Boolean(query.data?.length) && (
        <ul
          aria-label={t("templates.title")}
          className="divide-y divide-shell rounded-md border border-shell bg-surface"
        >
          {query.data?.map((template) => (
            <li
              key={template.id}
              className="flex flex-wrap items-center justify-between gap-4 p-4"
            >
              <div className="min-w-0 flex-1">
                <h2 className="wrap-anywhere font-semibold text-heading">
                  {template.name}
                </h2>
                {template.description && (
                  <p className="mt-1 whitespace-pre-wrap wrap-anywhere text-sm text-muted">
                    {template.description}
                  </p>
                )}
                <p className="mt-1 text-xs text-muted">
                  {t("templates.fieldCount", { count: template.fields.length })}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  aria-label={t("templates.editNamed", { name: template.name })}
                  title={t("common.actions.edit")}
                  onClick={(event) => {
                    editTrigger.current = event.currentTarget;
                    setEditingId(template.id);
                  }}
                  className="flex size-8 items-center justify-center rounded-md border border-shell enabled:hover:bg-control-hover enabled:hover:border-accent/50 focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <svg
                    aria-hidden="true"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="m16 3 5 5L8 21H3v-5L16 3Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label={t("templates.deleteNamed", {
                    name: template.name,
                  })}
                  title={t("common.actions.delete")}
                  onClick={() => setDeleting(template)}
                  className="flex size-8 items-center justify-center rounded-md bg-danger-soft text-danger enabled:hover:bg-danger/25 focus-visible:outline-2 focus-visible:outline-danger"
                >
                  <svg
                    aria-hidden="true"
                    className="size-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editingId && (
        <InventoryTemplateEditDialog
          key={editingId}
          id={editingId}
          onClose={closeEditor}
        />
      )}
      {deleting && (
        <InventoryTemplateDeleteDialog
          key={deleting.id}
          initial={deleting}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
