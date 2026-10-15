import { useTranslation } from "react-i18next";
import {
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";

import { useInventoryDraft } from "./InventoryDraftContext";
import { InventoryFieldCard } from "./InventoryFieldCard";
import { InventoryFieldCreateForm } from "./InventoryFieldCreateForm";
import { InventoryToolbar } from "./InventoryToolbar";
import { moveDraftField, type FieldDropSide } from "./inventoryEditorDraft";
import type { InventoryField } from "../types/inventoryField";

// Accept only field drags originating from this open editor, not sidebar or external data.
const fieldDragType = "application/x-inventory-manager-field";

/**
 * Render field configuration inside the inventory editor.
 * @returns Local field actions and draft definitions.
 */
export function InventoryFieldsPanel() {
  const { t } = useTranslation();
  const {
    fields: inventoryFields,
    canReorder,
    moveField,
  } = useInventoryDraft();
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<InventoryField[] | null>(null);
  const session = useRef<{
    source: string;
    fields: InventoryField[];
    placement: { id: string; side: FieldDropSide } | null;
  } | null>(null);
  const displayedFields = preview ?? inventoryFields;
  const [target, setTarget] = useState<{
    id: string;
    side: FieldDropSide;
  } | null>(null);
  const enabled = canReorder && inventoryFields.length > 1;
  const list = useRef<HTMLUListElement>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const positions = useRef<Map<string, number> | null>(null);
  const animations = useRef(new Map<string, Animation>());

  /**
   * Measure a row independently of scrolling and modal repositioning.
   * @param row The field row to measure.
   * @returns Its vertical position within the field list's scrollable content.
   */
  const rowPosition = useCallback((row: HTMLLIElement) => {
    const container = list.current;
    return (
      row.getBoundingClientRect().top -
      (container?.getBoundingClientRect().top ?? 0) +
      (container?.scrollTop ?? 0)
    );
  }, []);

  // Capture the current visual positions, including any unfinished earlier animation.
  const capturePositions = useCallback(() => {
    positions.current = new Map(
      Array.from(rows.current, ([id, row]) => [id, rowPosition(row)]),
    );
  }, [rowPosition]);

  useLayoutEffect(() => {
    const previous = positions.current;
    positions.current = null;
    if (!previous) return;
    // Cancel old transforms before measuring the final layout, then animate from the captured view.
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    for (const [id, row] of rows.current) {
      const before = previous.get(id);
      const offset = before === undefined ? 0 : before - rowPosition(row);
      if (Math.abs(offset) < 1 || typeof row.animate !== "function") continue;
      const animation = row.animate(
        [
          { transform: `translateY(${offset}px)` },
          { transform: "translateY(0)" },
        ],
        { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
      );
      animations.current.set(id, animation);
      animation.onfinish = () => {
        if (animations.current.get(id) === animation)
          animations.current.delete(id);
      };
    }
  });

  useEffect(() => {
    const running = animations.current;
    return () => {
      for (const animation of running.values()) animation.cancel();
      running.clear();
    };
  }, []);

  // Discard transient drag state without changing the inventory editor's draft.
  const clearDrag = useCallback(() => {
    session.current = null;
    setPreview(null);
    setDraggedId(null);
    setTarget(null);
  }, []);

  // Animate a canceled preview back to the unchanged draft order.
  const cancelMove = useCallback(() => {
    if (session.current) capturePositions();
    clearDrag();
  }, [capturePositions, clearDrag]);

  useEffect(() => {
    /**
     * Cancel only the active drag before the containing modal handles Escape.
     * @param event The browser keyboard event.
     */
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !session.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelMove();
    }
    window.addEventListener("keydown", cancelOnEscape, true);
    return () => window.removeEventListener("keydown", cancelOnEscape, true);
  }, [cancelMove]);

  /**
   * Determine the insertion side from the pointer's position within a field row.
   * @param event The row's drag event.
   * @returns Whether the pointer targets the row's upper or lower half.
   */
  function dropSide(event: DragEvent<HTMLLIElement>): FieldDropSide {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before";
  }

  /**
   * Check that the current editor recognizes the active drag session and its payload type.
   * @param event The drag-over or drop event.
   * @returns Whether this editor can accept the field drag.
   */
  function acceptsDrag(event: DragEvent) {
    return (
      enabled &&
      draggedId !== null &&
      session.current?.source === draggedId &&
      inventoryFields.some((field) => field.id === draggedId) &&
      event.dataTransfer.types.includes(fieldDragType)
    );
  }

  // Reserve a small usable field area; only extreme viewport constraints scroll the parent.
  return (
    <div className="flex min-h-40 min-w-0 flex-col">
      <div className="shrink-0">
        <InventoryToolbar actions={<InventoryFieldCreateForm />}>
          <h2 className="text-sm font-semibold text-heading">
            {t("fields.title")}
          </h2>
        </InventoryToolbar>
      </div>
      {inventoryFields.length > 1 && (
        <p className="mb-2 text-xs text-muted">{t("fields.reorderHint")}</p>
      )}

      {inventoryFields.length === 0 && (
        <section className="rounded-2xl border border-dashed border-shell bg-surface/70 px-6 py-12 text-center shadow-soft">
          <h2 className="text-lg font-semibold">{t("fields.empty")}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
            {t("fields.emptyDescription")}
          </p>
        </section>
      )}

      {inventoryFields.length > 0 && (
        <ul
          ref={list}
          aria-label={t("fields.title")}
          tabIndex={0}
          className="min-h-0 divide-y divide-shell overflow-y-auto overscroll-contain rounded-md border border-shell focus-visible:outline-2 focus-visible:outline-accent"
          onDragOver={(event) => {
            if (!acceptsDrag(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const current = session.current;
            if (
              !acceptsDrag(event) ||
              !current ||
              event.dataTransfer.getData(fieldDragType) !== current.source
            ) {
              cancelMove();
              return;
            }
            // Commit the last visible slot, even when dropping onto the moved field itself.
            if (
              current.placement &&
              current.fields.some(
                (field, index) => field.id !== inventoryFields[index]?.id,
              )
            )
              moveField(
                current.source,
                current.placement.id,
                current.placement.side,
              );
            clearDrag();
          }}
        >
          {displayedFields.map((inventoryField) => (
            <li
              ref={(row) => {
                if (row) rows.current.set(inventoryField.id, row);
                else rows.current.delete(inventoryField.id);
              }}
              key={inventoryField.id}
              draggable={false}
              className={`relative flex bg-surface transition-opacity duration-150 motion-reduce:transition-none before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:z-10 before:h-0.5 before:origin-left before:bg-accent before:transition-[opacity,transform] before:duration-150 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:z-10 after:h-0.5 after:origin-left after:bg-accent after:transition-[opacity,transform] after:duration-150 motion-reduce:before:transition-none motion-reduce:after:transition-none ${draggedId === inventoryField.id ? "opacity-50" : ""} ${target?.id === inventoryField.id && target.side === "before" ? "before:opacity-100 before:scale-x-100" : "before:opacity-0 before:scale-x-95"} ${target?.id === inventoryField.id && target.side === "after" ? "after:opacity-100 after:scale-x-100" : "after:opacity-0 after:scale-x-95"}`}
              onDragEnd={cancelMove}
              onDragOver={(event) => {
                if (!acceptsDrag(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const current = session.current;
                if (!current || current.source === inventoryField.id) return;
                const side = dropSide(event);
                setTarget((previous) =>
                  previous?.id === inventoryField.id && previous.side === side
                    ? previous
                    : { id: inventoryField.id, side },
                );
                const next = moveDraftField(
                  current.fields,
                  current.source,
                  inventoryField.id,
                  side,
                );
                if (next === current.fields) return;
                capturePositions();
                current.fields = next;
                current.placement = { id: inventoryField.id, side };
                setPreview(next);
              }}
            >
              <button
                type="button"
                tabIndex={-1}
                aria-label={t("fields.reorderField", {
                  name: inventoryField.name,
                })}
                title={t("fields.reorderHint")}
                disabled={!enabled}
                draggable={enabled}
                className="ml-2 flex size-7 shrink-0 self-center items-center justify-center rounded-sm text-muted transition-colors duration-150 motion-reduce:transition-none enabled:cursor-grab enabled:hover:bg-control-hover enabled:hover:text-accent enabled:active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
                onDragStart={(event) => {
                  if (!enabled) {
                    event.preventDefault();
                    return;
                  }
                  event.dataTransfer.setData(fieldDragType, inventoryField.id);
                  event.dataTransfer.effectAllowed = "move";
                  session.current = {
                    source: inventoryField.id,
                    fields: inventoryFields,
                    placement: null,
                  };
                  // Show the complete field as the native drag preview, not just its grip.
                  const row = event.currentTarget.closest("li");
                  if (row) {
                    const bounds = row.getBoundingClientRect();
                    event.dataTransfer.setDragImage?.(
                      row,
                      Math.max(0, event.clientX - bounds.left),
                      Math.max(0, event.clientY - bounds.top),
                    );
                  }
                  setDraggedId(inventoryField.id);
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
              <div className="min-w-0 flex-1">
                <InventoryFieldCard inventoryField={inventoryField} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
