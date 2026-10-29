import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InventoryAttachment } from "../types/inventoryItem";
import {
  attachmentDownloadUrl,
  downloadAttachment,
  attachmentPreviewUrl,
  canPreviewAttachment,
} from "../services/attachments";
import { ContextMenu } from "./ContextMenu";
import { Modal } from "./Modal";

/**
 * Identify image/document entries consistently when previews are disabled or unavailable.
 * @param props The file type hint and optional larger tile presentation.
 * @returns A decorative icon; the adjacent filename supplies the accessible label.
 */
function AttachmentIcon({
  file,
  tile = false,
}: {
  file: InventoryAttachment;
  tile?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`${tile ? "size-7" : "size-4"} shrink-0 text-muted`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      {file.media_type.startsWith("image/") ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="1" />
          <path d="m3 17 6-6 4 4 3-3 5 5" />
          <circle cx="16" cy="8" r="1" />
        </>
      ) : (
        <path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h5" />
      )}
    </svg>
  );
}

/**
 * Lazy-load generated thumbnails and retain a useful icon/name if a preview cannot be rendered.
 * @param props The immutable managed file metadata.
 * @returns A fixed-height image area that never crops the source or opens an image viewer.
 */
function AttachmentThumbnail({ file }: { file: InventoryAttachment }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="flex h-16 w-full items-center justify-center rounded-sm bg-surface-muted">
      {!failed && canPreviewAttachment(file) ? (
        <img
          src={attachmentPreviewUrl(file)}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-16 w-full object-contain"
        />
      ) : (
        <AttachmentIcon file={file} tile />
      )}
    </span>
  );
}

/**
 * Render compact filename links that download directly, with a bounded overflow list.
 * @param props Stored IDs and their saved public metadata.
 * @returns Wrapped file entries, optional full list, and cursor-positioned download actions.
 */
export function AttachmentCell({
  ids,
  files,
  previews = false,
}: {
  ids: unknown;
  files: InventoryAttachment[];
  previews?: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const [columns, setColumns] = useState(1);
  const hasFiles = Array.isArray(ids) && ids.length > 0;
  const [menu, setMenu] = useState<{
    file: InventoryAttachment;
    x: number;
    y: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!previews) return;
    const element = root.current;
    if (!element) return;
    // Match 112 px tiles plus the 6 px flex gap; at most two rows remain in the table cell.
    function measure(width = element!.getBoundingClientRect().width) {
      setColumns(Math.max(1, Math.floor((width + 6) / 118)));
    }
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver((entries) => {
        const entry = entries.find((entry) => entry.target === element);
        if (entry) measure(entry.contentRect.width);
      });
      observer.observe(element);
      return () => observer.disconnect();
    }
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [previews, hasFiles]);
  if (!Array.isArray(ids) || !ids.length) return <>—</>;
  const ordered = ids.map((id) => files.find((file) => file.id === id));

  /**
   * Render filename links without exposing raw IDs when metadata is missing.
   * @param limit Maximum visible files; the full-list dialog renders all entries.
   * @returns Wrapping file links with type hints and keyboard context-menu support.
   */
  function links(limit: number) {
    return (
      <ul className="flex min-w-0 flex-wrap gap-1.5">
        {ordered.slice(0, limit).map((file, index) => (
          <li key={file?.id ?? index} className="max-w-full min-w-0">
            {file ? (
              <a
                href={attachmentDownloadUrl(file)}
                download={file.filename}
                target="_self"
                title={file.filename}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  downloadAttachment(file);
                }}
                className={`max-w-full cursor-pointer items-center rounded-sm border border-shell bg-surface text-accent-text hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-accent ${previews ? "flex w-28 flex-col gap-1 p-1.5 text-xs" : "inline-flex gap-1.5 px-2 py-1 text-sm"}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenu({ file, x: event.clientX, y: event.clientY });
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === "ContextMenu" ||
                    (event.shiftKey && event.key === "F10")
                  ) {
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenu({ file, x: rect.left, y: rect.bottom });
                  }
                }}
              >
                {previews ? (
                  <AttachmentThumbnail file={file} />
                ) : (
                  <AttachmentIcon file={file} />
                )}
                <span className="max-w-full truncate">{file.filename}</span>
              </a>
            ) : (
              <span className="text-xs text-muted">
                {t("attachments.unavailable")}
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div ref={root} className="min-w-0">
      {links(previews ? columns * 2 : 3)}
      {ordered.length > (previews ? columns * 2 : 3) && (
        <button
          ref={moreTrigger}
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-xs text-accent-text underline"
        >
          {t("attachments.more", {
            count: ordered.length - (previews ? columns * 2 : 3),
          })}
        </button>
      )}
      {expanded && (
        <Modal
          title={t("attachments.title")}
          size="medium"
          onClose={() => {
            setExpanded(false);
            moreTrigger.current?.focus();
          }}
        >
          <div className="max-h-80 overflow-y-auto">
            {links(ordered.length)}
          </div>
        </Modal>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.file.filename}
          onClose={() => setMenu(null)}
          actions={[
            {
              label: t("attachments.saveAs"),
              onSelect: () => {
                downloadAttachment(menu.file);
                setMenu(null);
              },
            },
          ]}
        />
      )}
    </div>
  );
}
