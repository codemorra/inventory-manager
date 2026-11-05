import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InventoryAttachment } from "../types/inventoryItem";
import {
  attachmentPreviewUrl,
  downloadAttachment,
} from "../services/attachments";
import { AttachmentDownloadIcon } from "./AttachmentDownloadIcon";
import { ContextMenu } from "./ContextMenu";
import { Modal } from "./Modal";

/** Fetch one explicitly selected original; release pending requests and blob storage on dismissal. */
export function AttachmentPreviewModal({
  file,
  onClose,
}: {
  file: InventoryAttachment;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<string>();
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const content = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = () => {
    setMenu(null);
    content.current?.focus();
  };
  const [ratio, setRatio] = useState<number>();
  // Subtract the actual controls/padding from the height budget, including after window resizing.
  useLayoutEffect(() => {
    const dialog = content.current?.closest<HTMLElement>("[role=dialog]");
    if (!dialog || !ratio) return;
    const measure = () => {
      if (!image.current) return;
      const chrome =
        dialog.getBoundingClientRect().height -
        image.current.getBoundingClientRect().height;
      dialog.style.setProperty("--preview-chrome-height", `${chrome}px`);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    const header = dialog.firstElementChild;
    if (header) observer?.observe(header);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ratio]);
  const previewUrl = attachmentPreviewUrl(file);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = content.current?.closest("[role=dialog]");
    const close = dialog?.querySelector<HTMLButtonElement>("button");
    close?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const buttons = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [tabindex="0"]',
        ) ?? [],
      );
      const first = buttons[0];
      const last = buttons.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    dialog?.addEventListener("keydown", trap as EventListener);
    return () => {
      dialog?.removeEventListener("keydown", trap as EventListener);
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let url: string | undefined;
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    void (async () => {
      try {
        const response = await fetch(previewUrl, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (
          !response.ok ||
          !["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
            response.headers.get("Content-Type") ?? "",
          )
        )
          throw new Error("Preview unavailable");
        const blob = await response.blob();
        if (!active) return;
        url = URL.createObjectURL(blob);
        setSource(url);
      } catch {
        if (active) setStatus("error");
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [previewUrl]);
  return (
    <Modal
      title={file.filename}
      onClose={onClose}
      dialogClassName="[&_h2]:min-w-0 [&_h2]:truncate"
      dialogStyle={
        ratio
          ? {
              width: `min(90dvw, calc((90dvh - var(--preview-chrome-height, 11rem)) * ${ratio} + 2.5rem + 2px))`,
              maxWidth: "90dvw",
            }
          : { width: "min(32rem, 90dvw)", maxWidth: "90dvw" }
      }
      contentClassName="min-h-0"
    >
      <div
        ref={content}
        tabIndex={0}
        aria-label={file.filename}
        aria-haspopup="menu"
        className="flex min-h-0 flex-col gap-4 focus-visible:outline-2 focus-visible:outline-accent"
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.left, y: rect.top });
          }
        }}
      >
        {status === "loading" && (
          <p role="status">{t("attachments.previewLoading")}</p>
        )}
        {status === "error" && (
          <p role="alert">{t("attachments.previewFailed")}</p>
        )}
        {source && status !== "error" && (
          <img
            ref={image}
            src={source}
            alt={file.filename}
            className={`h-auto max-h-[calc(90dvh-var(--preview-chrome-height,11rem))] w-full object-contain ${status === "loading" ? "invisible" : ""}`}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) {
                setRatio(naturalWidth / naturalHeight);
                setStatus("ready");
              } else setStatus("error");
            }}
            onError={() => setStatus("error")}
          />
        )}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={file.filename}
          onClose={closeMenu}
          actions={[
            {
              label: t("attachments.saveAs"),
              icon: <AttachmentDownloadIcon />,
              onSelect: () => {
                downloadAttachment(file);
                closeMenu();
              },
            },
          ]}
        />
      )}
    </Modal>
  );
}
