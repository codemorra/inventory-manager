import { Children, type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";

// Share editable field requirements and sorting preferences between creation and editing.
interface InventoryFieldSettingsProps {
  required: boolean;
  sortable: boolean;
  disabled?: boolean;
  automatic?: boolean;
  children?: ReactNode;
  onRequiredChange: (value: boolean) => void;
  onSortableChange: (value: boolean) => void;
}

/**
 * Render field settings with explanations of their effect on existing entries.
 * @param required Whether item values must be provided for this field.
 * @param sortable Whether the item table can be sorted by this field.
 * @param disabled Whether the controls are disabled during saving.
 * @param automatic Whether values are generated rather than required from the user.
 * @param children Type-specific configuration shown above the shared settings.
 * @param onRequiredChange Update the local requirement setting.
 * @param onSortableChange Update the local sorting setting.
 * @returns The requirement and sortability controls.
 */
export function InventoryFieldSettings({
  required,
  sortable,
  disabled = false,
  automatic = false,
  children,
  onRequiredChange,
  onSortableChange,
}: InventoryFieldSettingsProps) {
  const { t } = useTranslation();
  const id = useId();
  // Ignore false and null conditional children so empty settings never leave a divider.
  const typeSettings = Children.toArray(children);
  return (
    <fieldset
      className="mt-4 rounded-md border border-shell bg-surface-muted px-4 pb-3 pt-2"
      disabled={disabled}
    >
      <legend className="px-1 text-sm font-medium">
        {t("fields.settings.title")}
      </legend>
      <div className="space-y-3">
        {typeSettings.length > 0 && (
          <div className="border-b border-shell pb-3">{typeSettings}</div>
        )}
        {!automatic && (
          <div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                className="size-4 accent-accent"
                type="checkbox"
                checked={required}
                aria-describedby={`${id}-required`}
                onChange={(event) => onRequiredChange(event.target.checked)}
              />
              {t("fields.settings.required")}
            </label>
            <p className="mt-1 text-xs text-muted" id={`${id}-required`}>
              {t("fields.settings.requiredHelp")}
            </p>
          </div>
        )}
        <div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              className="size-4 accent-accent"
              type="checkbox"
              checked={sortable}
              aria-describedby={`${id}-sortable`}
              onChange={(event) => onSortableChange(event.target.checked)}
            />
            {t("fields.settings.sortable")}
          </label>
          <p className="mt-1 text-xs text-muted" id={`${id}-sortable`}>
            {t("fields.settings.sortableHelp")}
          </p>
        </div>
      </div>
    </fieldset>
  );
}
