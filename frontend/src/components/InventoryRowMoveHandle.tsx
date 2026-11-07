import { useEffect, useId, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

interface InventoryRowMoveHandleProps {
  sorted: boolean;
  disabled: boolean;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onMove: (direction: -1 | 1) => void;
}

/** Offer pointer dragging and keyboard movement with an unclipped explanatory tooltip. */
export function InventoryRowMoveHandle({
  sorted,
  disabled,
  onDragStart,
  onDragEnd,
  onMove,
}: InventoryRowMoveHandleProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(
    null,
  );
  const blocked = sorted || disabled;
  const hint = t(
    sorted ? "table.edit.reorderSortedHint" : "table.edit.reorderHint",
  );

  useEffect(() => {
    if (!anchor) return;
    const dismiss = () => setAnchor(null);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [anchor]);

  function showHint(button: HTMLButtonElement) {
    const rect = button.getBoundingClientRect();
    setAnchor({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 264)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 88)),
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label={t("table.edit.reorder")}
        aria-disabled={blocked}
        aria-describedby={hintId}
        draggable={!blocked}
        className={`flex size-7 shrink-0 items-center justify-center rounded-sm text-muted transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-accent ${blocked ? "cursor-default opacity-40" : "cursor-grab hover:bg-control-hover hover:text-accent-text active:cursor-grabbing"}`}
        onMouseEnter={(event) => showHint(event.currentTarget)}
        onMouseLeave={() => setAnchor(null)}
        onFocus={(event) => showHint(event.currentTarget)}
        onBlur={() => setAnchor(null)}
        onDragStart={(event) => {
          if (blocked) {
            event.preventDefault();
            return;
          }
          setAnchor(null);
          onDragStart(event);
        }}
        onDragEnd={onDragEnd}
        onKeyDown={(event) => {
          if (event.key === "Escape") setAnchor(null);
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          if (!blocked) onMove(event.key === "ArrowUp" ? -1 : 1);
        }}
      >
        <svg
          aria-hidden="true"
          className="size-4"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          {[4, 8, 12].map((y) => (
            <g key={y}>
              <circle cx="5" cy={y} r="1" />
              <circle cx="11" cy={y} r="1" />
            </g>
          ))}
        </svg>
      </button>
      {anchor ? (
        createPortal(
          <span
            id={hintId}
            role="tooltip"
            style={anchor}
            className="pointer-events-none fixed z-50 w-64 rounded-sm border border-shell bg-surface p-2 text-xs text-foreground shadow-md"
          >
            {hint}
          </span>,
          document.body,
        )
      ) : (
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      )}
    </>
  );
}
