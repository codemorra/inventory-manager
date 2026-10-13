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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        aria-labelledby="modal-title"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold" id="modal-title">
            {title}
          </h2>
          <button
            aria-label={t("common.actions.closeDialog")}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
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
