import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type RefObject,
} from "react";
import type { InventoryItem } from "../types/inventoryItem";

const rowDragType = "application/x-inventory-manager-item";
type Placement = { id: string; side: "before" | "after" };

/** Preview and animate table row moves using the inventory field editor's drag presentation. */
export function useInventoryRowDrag(
  items: InventoryItem[],
  container: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onMove: (source: string, target: string, side: Placement["side"]) => void,
) {
  const session = useRef<{
    source: string;
    items: InventoryItem[];
    placement: Placement | null;
  } | null>(null);
  const [preview, setPreview] = useState<InventoryItem[] | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [target, setTarget] = useState<Placement | null>(null);
  const positions = useRef<Map<string, number> | null>(null);
  const animations = useRef(new Map<string, Animation>());

  const capturePositions = useCallback(() => {
    const top = container.current?.getBoundingClientRect().top ?? 0;
    positions.current = new Map(
      Array.from(
        container.current?.querySelectorAll<HTMLElement>(
          "[data-drag-row-id]",
        ) ?? [],
        (row) => [
          row.dataset.dragRowId!,
          row.getBoundingClientRect().top - top,
        ],
      ),
    );
  }, [container]);

  useLayoutEffect(() => {
    const previous = positions.current;
    positions.current = null;
    if (!previous) return;
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const top = container.current?.getBoundingClientRect().top ?? 0;
    for (const row of container.current?.querySelectorAll<HTMLElement>(
      "[data-drag-row-id]",
    ) ?? []) {
      const id = row.dataset.dragRowId!;
      const before = previous.get(id);
      const offset =
        before === undefined
          ? 0
          : before - (row.getBoundingClientRect().top - top);
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

  const clear = useCallback(() => {
    session.current = null;
    setPreview(null);
    setDraggedId(null);
    setTarget(null);
  }, []);

  const cancel = useCallback(() => {
    if (session.current) capturePositions();
    clear();
  }, [capturePositions, clear]);

  useEffect(() => {
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !session.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    }
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [cancel]);

  function accepts(event: DragEvent) {
    return (
      enabled &&
      session.current &&
      items.some((item) => item.id === session.current?.source) &&
      event.dataTransfer.types.includes(rowDragType)
    );
  }

  function begin(itemId: string, event: DragEvent<HTMLButtonElement>) {
    if (!enabled) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(rowDragType, itemId);
    event.dataTransfer.effectAllowed = "move";
    session.current = { source: itemId, items, placement: null };
    const row = event.currentTarget.closest("tr");
    if (row) {
      const bounds = row.getBoundingClientRect();
      event.dataTransfer.setDragImage?.(
        row,
        Math.max(0, event.clientX - bounds.left),
        Math.max(0, event.clientY - bounds.top),
      );
    }
    setDraggedId(itemId);
  }

  function over(itemId: string, event: DragEvent<HTMLTableRowElement>) {
    if (!accepts(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const current = session.current!;
    if (current.source === itemId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const side =
      event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before";
    setTarget((previous) =>
      previous?.id === itemId && previous.side === side
        ? previous
        : { id: itemId, side },
    );
    const source = current.items.find((item) => item.id === current.source)!;
    const next = current.items.filter((item) => item.id !== source.id);
    const index = next.findIndex((item) => item.id === itemId);
    if (index < 0) return;
    next.splice(index + (side === "after" ? 1 : 0), 0, source);
    if (next.every((item, index) => item.id === current.items[index]?.id))
      return;
    capturePositions();
    current.items = next;
    current.placement = { id: itemId, side };
    setPreview(next);
  }

  function drop(event: DragEvent) {
    const current = session.current;
    if (!current) return;
    event.preventDefault();
    if (
      !accepts(event) ||
      event.dataTransfer.getData(rowDragType) !== current.source
    ) {
      cancel();
      return;
    }
    if (current.placement)
      onMove(current.source, current.placement.id, current.placement.side);
    clear();
  }

  return {
    items: preview ?? items,
    draggedId,
    target,
    begin,
    over,
    drop,
    cancel,
  };
}
