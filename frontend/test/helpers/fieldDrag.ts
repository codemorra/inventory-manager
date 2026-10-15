import { createEvent, fireEvent } from "@testing-library/react";

// Keep test payloads aligned with the field-only drag contract, not the sidebar inventory type.
export const fieldDragType = "application/x-inventory-manager-field";

/**
 * Start a field drag with a mutable payload that can also exercise invalid drop scenarios.
 * @param source The field row containing the native drag handle.
 * @returns The drag transfer object shared across subsequent events.
 */
export function startFieldDrag(source: HTMLElement) {
  const data = new Map<string, string>();
  const transfer = {
    types: [fieldDragType],
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
  const handle =
    source.querySelector<HTMLButtonElement>("button[draggable]") ?? source;
  fireEvent.pointerDown(handle);
  fireEvent.dragStart(handle, { dataTransfer: transfer });
  return transfer;
}

/**
 * Supply an explicit pointer coordinate even when jsdom has no DragEvent layout implementation.
 * @param kind Whether to preview an insertion or complete the drop.
 * @param target The target field row.
 * @param transfer The current drag payload.
 * @param side Which half of the row the pointer targets.
 * @returns Whether the native event was left uncanceled.
 */
export function fieldDragEvent(
  kind: "dragOver" | "drop",
  target: HTMLElement,
  transfer: ReturnType<typeof startFieldDrag>,
  side: "before" | "after",
) {
  const bounds = target.getBoundingClientRect();
  const event = createEvent[kind](target, { dataTransfer: transfer });
  Object.defineProperty(event, "clientY", {
    value: bounds.top + bounds.height / 2 + (side === "before" ? -1 : 1),
  });
  return fireEvent(target, event);
}

/**
 * Move a field through the same native events emitted by a complete pointer drag.
 * @param source The field row to move.
 * @param target The row defining the insertion point.
 * @param side Whether to insert before or after the target.
 */
export function dragField(
  source: HTMLElement,
  target: HTMLElement,
  side: "before" | "after",
) {
  const transfer = startFieldDrag(source);
  fieldDragEvent("dragOver", target, transfer, side);
  fieldDragEvent("drop", target, transfer, side);
  fireEvent.dragEnd(source);
}
