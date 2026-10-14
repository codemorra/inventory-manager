import { type ReactNode, useEffect, useId } from "react";
import { useTranslation } from "react-i18next";

// Define properties for a modal dialog.
interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  title: string;
  size?: "small" | "medium" | "large";
}

/**
 * Render an accessible modal dialog above the current page.
 * @param children The content to display inside the modal.
 * @param onClose The function to call when the modal should be closed.
 * @param title The title of the modal dialog.
 * @param size The content width appropriate for the form.
 * @returns The modal overlay and dialog content.
 */
export function Modal({
  children,
  onClose,
  title,
  size = "large",
}: ModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const width = { small: "max-w-md", medium: "max-w-xl", large: "max-w-3xl" }[
    size
  ];
  useEffect(() => {
    /**
     * Dismiss the dialog when Escape is pressed.
     * @param event The keyboard event to handle.
     */
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className={`max-h-[90dvh] w-full overflow-y-auto rounded-2xl border border-shell bg-surface shadow-raised ${width}`}
        role="dialog"
      >
        <div className="flex items-center justify-between gap-4 border-b border-shell bg-surface-muted px-5 py-4">
          <h2
            className="text-lg font-semibold tracking-tight text-heading"
            id={titleId}
          >
            {title}
          </h2>
          <button
            aria-label={t("common.actions.closeDialog")}
            className="shrink-0 rounded-md p-1.5 text-muted transition hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
            onClick={onClose}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="size-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              viewBox="0 0 24 24"
            >
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </section>
    </div>
  );
}
