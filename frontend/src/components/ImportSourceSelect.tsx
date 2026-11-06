import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { InventoryImportFormat } from "../types/tableImport";

const formats = [
  { value: "zip", label: "ZIP" },
  { value: "csv", label: "CSV" },
  { value: "markdown", label: "Markdown" },
] as const;

/** Present the three import formats together, keeping native radio keyboard and disabled behavior. */
export function ImportSourceSelect({
  format,
  disabled,
  onChange,
}: {
  format: InventoryImportFormat;
  disabled: boolean;
  onChange: (format: InventoryImportFormat) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <fieldset className="min-w-0 max-w-xl">
      <legend className="mb-2 text-sm font-medium text-foreground">
        {t("tableImports.format")}
      </legend>
      <div className="grid grid-cols-3 gap-1 rounded-md border border-shell bg-surface-muted p-1">
        {formats.map((option) => (
          <label key={option.value} className="min-w-0">
            <input
              type="radio"
              name={`${id}-source`}
              value={option.value}
              checked={format === option.value}
              disabled={disabled}
              className="peer sr-only"
              onChange={() => onChange(option.value)}
            />
            <span className="block cursor-pointer rounded-sm border border-transparent px-3 py-2 text-center text-sm font-medium text-muted transition hover:bg-control-hover peer-checked:border-accent/40 peer-checked:bg-accent-soft peer-checked:text-accent-text peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
