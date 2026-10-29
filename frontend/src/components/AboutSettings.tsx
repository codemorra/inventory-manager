import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import licenseText from "../../../LICENSE?raw";
import { Modal } from "./Modal";
import { UpdateSettings } from "./UpdateSettings";

/**
 * Show application ownership, project information and manually requested update checks.
 * @returns Application details and an accessible view of the original MIT license.
 */
export function AboutSettings() {
  const { t } = useTranslation();
  const [licenseOpen, setLicenseOpen] = useState(false);
  return (
    <>
      <h3 className="text-xl font-semibold text-heading">{t("app.name")}</h3>
      <p className="mt-2 text-sm text-muted">
        {t("settings.aboutDescription")}
      </p>
      <dl className="mt-6 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="text-muted">{t("settings.author")}</dt>
        <dd>Christopher Kranz</dd>
        <dt className="text-muted">{t("settings.project")}</dt>
        <dd className="min-w-0">
          <a
            href="https://github.com/codemorra/inventory-manager"
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            github.com/codemorra/inventory-manager
          </a>
        </dd>
        <dt className="text-muted">{t("settings.license")}</dt>
        <dd>
          <button
            type="button"
            onClick={() => setLicenseOpen(true)}
            className="text-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
          >
            MIT
          </button>
        </dd>
      </dl>
      <p className="mt-5 text-xs text-muted">© 2026 Christopher Kranz</p>
      <UpdateSettings />
      {licenseOpen && <LicenseDialog onClose={() => setLicenseOpen(false)} />}
    </>
  );
}

/**
 * Display the original license with keyboard scrolling and restored trigger focus.
 * @param onClose Dismiss the license view.
 * @returns The original MIT license in a themed dialog.
 */
function LicenseDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const text = useRef<HTMLPreElement>(null);
  const [trigger] = useState(() => document.activeElement);
  useEffect(() => {
    text.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, [trigger]);
  return (
    <Modal title={t("settings.licenseTitle")} onClose={onClose} size="large">
      <pre
        ref={text}
        tabIndex={0}
        className="whitespace-pre-wrap wrap-break-word font-mono text-xs leading-relaxed text-foreground focus-visible:outline-2 focus-visible:outline-accent"
      >
        {licenseText}
      </pre>
    </Modal>
  );
}
