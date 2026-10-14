import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";

// Define properties for a modal dialog.
interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  title: string;
}

/**
 * Render an accessible modal dialog above the current page.
 * @param children The content to display inside the modal.
 * @param onClose The function to call when the modal should be closed.
 * @param title The title of the modal dialog.
 */
export function Modal({ children, onClose, title }: ModalProps) {
  const { t } = useTranslation();
  useEffect(() => {
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
        aria-labelledby="modal-title"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-shell bg-surface p-6 shadow-raised sm:p-7"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            className="text-xl font-semibold tracking-tight text-heading"
            id="modal-title"
          >
            {title}
          </h2>
          <button
            aria-label={t("common.actions.closeDialog")}
            className="rounded-lg border border-shell px-3 py-2 text-sm font-medium transition hover:bg-surface-hover"
            onClick={onClose}
            type="button"
          >
            {t("common.actions.closeDialog")}
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </section>
    </div>
  );
}
