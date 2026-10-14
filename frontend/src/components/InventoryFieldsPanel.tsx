import { useTranslation } from "react-i18next";

import { useInventoryDraft } from "./InventoryDraftContext";
import { InventoryFieldCard } from "./InventoryFieldCard";
import { InventoryFieldCreateForm } from "./InventoryFieldCreateForm";
import { InventoryToolbar } from "./InventoryToolbar";

/**
 * Render field configuration inside the inventory editor.
 * @returns Local field actions and draft definitions.
 */
export function InventoryFieldsPanel() {
  const { t } = useTranslation();
  const { fields: inventoryFields } = useInventoryDraft();

  // Reserve a small usable field area; only extreme viewport constraints scroll the parent.
  return (
    <div className="flex min-h-40 min-w-0 flex-col">
      <div className="shrink-0">
        <InventoryToolbar actions={<InventoryFieldCreateForm />}>
          <h2 className="text-sm font-semibold text-heading">
            {t("fields.title")}
          </h2>
        </InventoryToolbar>
      </div>

      {inventoryFields.length === 0 && (
        <section className="rounded-2xl border border-dashed border-shell bg-surface/70 px-6 py-12 text-center shadow-soft">
          <h2 className="text-lg font-semibold">{t("fields.empty")}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            {t("fields.emptyDescription")}
          </p>
        </section>
      )}

      {inventoryFields.length > 0 && (
        <ul
          aria-label={t("fields.title")}
          tabIndex={0}
          className="min-h-0 divide-y divide-shell overflow-y-auto overscroll-contain rounded-md border border-shell focus-visible:outline-2 focus-visible:outline-accent"
        >
          {inventoryFields.map((inventoryField) => (
            <li key={inventoryField.id}>
              <InventoryFieldCard inventoryField={inventoryField} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
