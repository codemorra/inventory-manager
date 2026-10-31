import { useRef, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  clampColumnWidth,
  MIN_COLUMN_WIDTH,
  MAX_COLUMN_WIDTH,
} from "../appearance/inventoryColumns";

// Keep pointer movement local until a completed drag commits the new width.
interface ResizeSession {
  pointerId: number;
  startX: number;
  startWidth: number;
  width: number;
  moved: boolean;
}

// Separate temporary display changes from persistent column preferences.
interface ColumnResizeHandleProps {
  fieldName: string;
  width: number;
  displayWidth?: number;
  disabled?: boolean;
  onPreview: (width: number | null) => void;
  onCommit: (width: number) => void;
  onReset: () => void;
}

/**
 * Resize a column with pointer capture, keyboard steps, or a double-click reset.
 * @param props The field label, width, availability, and preview/commit/reset callbacks.
 * @returns A focusable separator at the right edge of the column header.
 */
export function ColumnResizeHandle({
  fieldName,
  width,
  displayWidth = width,
  disabled = false,
  onPreview,
  onCommit,
  onReset,
}: ColumnResizeHandleProps) {
  const { t } = useTranslation();
  const session = useRef<ResizeSession | null>(null);

  /**
   * Finish or cancel one captured pointer session and discard its live preview.
   * @param event The pointer ending the resize.
   * @param commit Whether to persist the preview width.
   */
  function finish(event: PointerEvent<HTMLDivElement>, commit: boolean) {
    const current = session.current;
    if (!current || current.pointerId !== event.pointerId) return;
    session.current = null;
    if (commit && current.moved) onCommit(current.width);
    onPreview(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return (
    <div
      role="separator"
      tabIndex={disabled ? -1 : 0}
      aria-label={t("table.resize.label", { field: fieldName })}
      aria-orientation="vertical"
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={Math.max(MAX_COLUMN_WIDTH, width)}
      aria-valuenow={width}
      aria-valuetext={t("table.resize.value", { width })}
      aria-disabled={disabled || undefined}
      title={t("table.resize.hint")}
      className={`group/resize absolute inset-y-0 right-0 z-10 w-2 touch-none outline-none focus-visible:bg-accent-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${disabled ? "cursor-default" : "cursor-col-resize hover:bg-accent-soft"}`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!disabled) onReset();
      }}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0 || session.current) return;
        event.preventDefault();
        event.stopPropagation();
        // Start at the visible edge, including surplus allocated to an automatic column.
        const startWidth = displayWidth;
        session.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth,
          width: startWidth,
          moved: false,
        };
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const current = session.current;
        if (!current || current.pointerId !== event.pointerId) return;
        current.width = clampColumnWidth(
          current.startWidth + event.clientX - current.startX,
        );
        if (current.width !== current.startWidth) current.moved = true;
        onPreview(current.width);
      }}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onLostPointerCapture={(event) => finish(event, false)}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === "Escape" && session.current) {
          event.preventDefault();
          event.stopPropagation();
          const pointerId = session.current.pointerId;
          session.current = null;
          onPreview(null);
          if (event.currentTarget.hasPointerCapture?.(pointerId))
            event.currentTarget.releasePointerCapture(pointerId);
          return;
        }
        if (session.current) return;
        const step = event.shiftKey ? 48 : 16;
        const next =
          event.key === "ArrowLeft"
            ? width - step
            : event.key === "ArrowRight"
              ? width + step
              : event.key === "Home"
                ? MIN_COLUMN_WIDTH
                : event.key === "End"
                  ? MAX_COLUMN_WIDTH
                  : null;
        if (next !== null) {
          event.preventDefault();
          event.stopPropagation();
          onCommit(clampColumnWidth(next));
        }
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-2 right-0 w-px bg-shell group-hover/resize:bg-accent group-focus-visible/resize:bg-accent"
      />
    </div>
  );
}
