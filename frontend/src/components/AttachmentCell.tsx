import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InventoryAttachment } from "../types/inventoryItem";
import {
  attachmentDownloadUrl,
  downloadAttachment,
  canPreviewAttachment,
} from "../services/attachments";
import { AttachmentDownloadIcon } from "./AttachmentDownloadIcon";
import { ContextMenu } from "./ContextMenu";
import { AttachmentPreviewModal } from "./AttachmentPreviewModal";
import { Modal } from "./Modal";

/**
 * Identify image/document entries without loading image bytes.
 * @param props The file type hint.
 * @returns A decorative icon; the adjacent filename supplies the accessible label.
 */
function AttachmentIcon({ file }: { file: InventoryAttachment }) {
  return (
    <svg
      aria-hidden="true"
      className="size-4 shrink-0 text-muted"
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
 * Render compact filename links with explicit image previews and a bounded overflow list.
 * @param props Stored IDs and their saved public metadata.
 * @returns Wrapped file entries, optional full list, and cursor-positioned download actions.
 */
export function AttachmentCell({
  ids,
  files,
}: {
  ids: unknown;
  files: InventoryAttachment[];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const moreTrigger = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<InventoryAttachment | null>(null);
  const [menu, setMenu] = useState<{
    file: InventoryAttachment;
    x: number;
    y: number;
  } | null>(null);
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
                aria-haspopup={
                  canPreviewAttachment(file) ? "dialog" : undefined
                }
                href={attachmentDownloadUrl(file)}
                download={file.filename}
                target="_self"
                title={file.filename}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (canPreviewAttachment(file)) setPreview(file);
                  else downloadAttachment(file);
                }}
                className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm border border-shell bg-surface px-2 py-1 text-sm text-accent-text hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-accent"
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
                <AttachmentIcon file={file} />
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
    <div className="min-w-0">
      {links(3)}
      {ordered.length > 3 && (
        <button
          ref={moreTrigger}
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-xs text-accent-text underline"
        >
          {t("attachments.more", {
            count: ordered.length - 3,
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
      {preview && ordered.some((file) => file?.id === preview.id) && (
        <AttachmentPreviewModal
          key={preview.id}
          file={preview}
          onClose={() => setPreview(null)}
        />
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
              icon: <AttachmentDownloadIcon />,
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
