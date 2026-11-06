import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

/** Open the native picker through a shared themed button without exposing its empty filename placeholder. */
export function ImportFileInput({
  label,
  accept,
  disabled,
  onSelect,
}: {
  label: string;
  accept: string;
  disabled: boolean;
  onSelect: (file: File) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="min-w-0">
      <label
        id={`${id}-label`}
        htmlFor={id}
        className="block text-sm font-medium"
      >
        {label}
      </label>
      <input
        id={id}
        ref={input}
        type="file"
        accept={accept}
        disabled={disabled}
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) onSelect(file);
        }}
      />
      <button
        type="button"
        autoFocus
        disabled={disabled}
        aria-describedby={`${id}-label`}
        className="mt-1.5 inline-flex items-center gap-2 rounded-md border border-shell bg-surface px-3 py-2.5 text-sm font-medium text-foreground outline-none transition enabled:hover:border-accent/50 enabled:hover:bg-control-hover focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => input.current?.click()}
      >
        <svg
          aria-hidden="true"
          className="size-4 shrink-0 text-muted"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M12 17v-6m-3 3 3-3 3 3"
          />
        </svg>
        {t("tableImports.chooseFile")}
      </button>
    </div>
  );
}
