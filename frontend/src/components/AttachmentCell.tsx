import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { InventoryAttachment } from "../types/inventoryItem";
import {
  attachmentDownloadUrl,
  downloadAttachment,
} from "../services/attachments";
import { ContextMenu } from "./ContextMenu";
import { Modal } from "./Modal";

/**
 * Render compact filename links that download directly, with a bounded overflow list.
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
          <li key={index} className="max-w-full min-w-0">
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
                className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm border border-shell bg-surface px-2 py-1 text-sm text-accent hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-accent"
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
                    <>
                      <path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h5" />
                    </>
                  )}
                </svg>
                <span className="truncate">{file.filename}</span>
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
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 text-xs text-accent underline"
        >
          {t("attachments.more", { count: ordered.length - 3 })}
        </button>
      )}
      {expanded && (
        <Modal
          title={t("attachments.title")}
          size="medium"
          onClose={() => setExpanded(false)}
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
