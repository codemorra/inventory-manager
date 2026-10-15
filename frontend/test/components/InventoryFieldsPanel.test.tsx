import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { InventoryFieldsPanel } from "../../src/components/InventoryFieldsPanel";
import { renderDraftControl, field } from "../helpers/inventoryDraft";
import { InventoryDraftContext } from "../../src/components/InventoryDraftContext";
import { moveDraftField } from "../../src/components/inventoryEditorDraft";
import {
  dragField,
  fieldDragEvent,
  fieldDragType,
  startFieldDrag,
} from "../helpers/fieldDrag";
const nativeAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "animate",
);
afterEach(() => {
  cleanup();
  if (nativeAnimate)
    Object.defineProperty(Element.prototype, "animate", nativeAnimate);
  else Reflect.deleteProperty(Element.prototype, "animate");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Render a stateful field list with deterministic layout measurements and native animation spies.
 * @param reduced Whether the browser requests reduced motion.
 * @returns The view, row animation spy, and cancellation spy.
 */
function renderAnimatedFields(reduced = false) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduced })),
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (
        this.matches("li") &&
        this.parentElement?.matches('ul[aria-label="Inventory fields"]')
      ) {
        const index = Array.from(this.parentElement.children).indexOf(this);
        return new DOMRect(
          0,
          500 + index * 100 - this.parentElement.scrollTop,
          500,
          100,
        );
      }
      return new DOMRect(0, 500, 500, 200);
    },
  );
  const cancel = vi.fn();
  const move = vi.fn();
  const animate = vi.fn<
    (
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
    ) => { cancel: () => void; onfinish: null }
  >(() => ({ cancel, onfinish: null }));
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: animate,
  });
  // Apply actual local ordering so the layout effect sees both pre-drop and post-drop positions.
  function Harness() {
    const [fields, setFields] = useState([
      field,
      { ...field, id: "other", name: "Other" },
    ]);
    return (
      <InventoryDraftContext.Provider
        value={{
          fields,
          disabled: false,
          canReorder: true,
          addField: vi.fn(),
          updateField: vi.fn(),
          removeField: vi.fn(),
          setPendingEditor: vi.fn(),
          moveField: (source, target, side) => {
            move(source, target, side);
            setFields((current) =>
              moveDraftField(current, source, target, side),
            );
          },
        }}
      >
        <InventoryFieldsPanel />
      </InventoryDraftContext.Provider>
    );
  }
  return { ...render(<Harness />), animate, cancel, move };
}

// Test immediate layout previews and committing the visible slot without a release-time reorder.
test.each(["source", "target", "list"])(
  "previews before releasing onto the %s",
  (destination) => {
    const { animate, move } = renderAnimatedFields();
    const a = screen.getByText("Brand").closest("li")!;
    const b = screen.getByText("Other").closest("li")!;
    const list = screen.getByRole("list", { name: "Inventory fields" });
    const transfer = startFieldDrag(b);
    fieldDragEvent("dragOver", a, transfer, "before");
    expect(
      within(list)
        .getAllByRole("heading")
        .map((entry) => entry.textContent),
    ).toEqual(["Other", "Brand"]);
    expect(move).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(2);
    // A different drop coordinate must not undo the already visible preview.
    fieldDragEvent(
      "drop",
      destination === "source" ? b : destination === "target" ? a : list,
      transfer,
      "after",
    );
    expect(move).toHaveBeenCalledExactlyOnceWith("other", field.id, "before");
    expect(
      within(list)
        .getAllByRole("heading")
        .map((entry) => entry.textContent),
    ).toEqual(["Other", "Brand"]);
    expect(animate).toHaveBeenCalledTimes(2);
  },
);

// Test canceled and invalid previews slide back without changing the inventory draft.
test.each(["cancel", "invalid", "escape"])(
  "restores the original order after an %s preview",
  (reason) => {
    const { animate, move } = renderAnimatedFields();
    const a = screen.getByText("Brand").closest("li")!;
    const b = screen.getByText("Other").closest("li")!;
    const transfer = startFieldDrag(b);
    fieldDragEvent("dragOver", a, transfer, "before");
    expect(animate).toHaveBeenCalledTimes(2);
    if (reason === "cancel") fireEvent.dragEnd(b);
    else if (reason === "escape") fireEvent.keyDown(window, { key: "Escape" });
    else {
      transfer.setData(fieldDragType, "unrelated-field");
      fieldDragEvent("drop", a, transfer, "before");
    }
    expect(
      within(screen.getByRole("list", { name: "Inventory fields" }))
        .getAllByRole("heading")
        .map((entry) => entry.textContent),
    ).toEqual(["Brand", "Other"]);
    expect(move).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledTimes(4);
  },
);

// Test real layout offsets, scroll-independent measurements, and cancellation during rapid moves.
test("animates rows into position and cancels unfinished animations on another move", () => {
  const { animate, cancel, unmount } = renderAnimatedFields();
  const list = screen.getByRole("list", { name: "Inventory fields" });
  list.scrollTop = 40;
  const a = screen.getByText("Brand").closest("li")!;
  const b = screen.getByText("Other").closest("li")!;
  dragField(b, a, "before");
  expect(animate).toHaveBeenCalledTimes(2);
  expect(animate.mock.calls.map((call) => call[0])).toEqual(
    expect.arrayContaining([
      [{ transform: "translateY(100px)" }, { transform: "translateY(0)" }],
      [{ transform: "translateY(-100px)" }, { transform: "translateY(0)" }],
    ]),
  );
  expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 220 });
  dragField(a, b, "before");
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(animate).toHaveBeenCalledTimes(4);
  unmount();
  expect(cancel).toHaveBeenCalledTimes(4);
});

// Test that reduced motion preserves ordering while skipping layout animations entirely.
test("respects reduced motion when reordering fields", () => {
  const { animate } = renderAnimatedFields(true);
  dragField(
    screen.getByText("Other").closest("li")!,
    screen.getByText("Brand").closest("li")!,
    "before",
  );
  expect(animate).not.toHaveBeenCalled();
  expect(
    within(screen.getByRole("list", { name: "Inventory fields" }))
      .getAllByRole("heading")
      .map((entry) => entry.textContent),
  ).toEqual(["Other", "Brand"]);
});

// Test that canceled drags and unchanged insertion points never trigger motion.
test("does not animate canceled or unchanged field drags", () => {
  const { animate } = renderAnimatedFields();
  const a = screen.getByText("Brand").closest("li")!;
  const b = screen.getByText("Other").closest("li")!;
  startFieldDrag(a);
  fireEvent.dragEnd(a);
  dragField(a, b, "before");
  expect(animate).not.toHaveBeenCalled();
});

// Test both insertion sides using native handle drags without making the field row draggable.
test.each(["before", "after"] as const)(
  "moves a field %s its target",
  (side) => {
    const fields = [field, { ...field, id: "other", name: "Other" }];
    const { actions } = renderDraftControl(<InventoryFieldsPanel />, {
      fields,
    });
    const rows = within(
      screen.getByRole("list", { name: "Inventory fields" }),
    ).getAllByRole("listitem");
    expect(rows[0]).toHaveAttribute("draggable", "false");
    expect(
      within(rows[0]).getByRole("button", { name: "Reorder Brand" }),
    ).toHaveAttribute("draggable", "true");
    expect(
      within(rows[0]).getByRole("button", { name: "Reorder Brand" }),
    ).toHaveClass("self-center");
    dragField(
      rows[side === "before" ? 1 : 0],
      rows[side === "before" ? 0 : 1],
      side,
    );
    expect(actions.moveField).toHaveBeenCalledWith(
      side === "before" ? "other" : field.id,
      side === "before" ? field.id : "other",
      side,
    );
  },
);

// Test insertion highlighting, cancellation, and guarded drag payloads from this editor only.
test("highlights valid targets and rejects external, altered, and canceled drags", () => {
  const { actions } = renderDraftControl(<InventoryFieldsPanel />, {
    fields: [field, { ...field, id: "other", name: "Other" }],
  });
  const rows = screen.getAllByRole("listitem");
  const transfer = startFieldDrag(rows[0]);
  fieldDragEvent("dragOver", rows[1], transfer, "before");
  expect(rows[1]).toHaveClass(
    "before:opacity-100",
    "before:duration-150",
    "motion-reduce:before:transition-none",
  );
  fieldDragEvent("dragOver", rows[1], transfer, "after");
  expect(rows[1]).toHaveClass("after:opacity-100");
  fireEvent.dragEnd(rows[0]);
  expect(rows[0]).not.toHaveClass("opacity-50");
  expect(rows[1]).not.toHaveClass("after:opacity-100");
  fieldDragEvent("drop", rows[1], transfer, "before");
  expect(actions.moveField).not.toHaveBeenCalled();
  const changed = startFieldDrag(rows[0]);
  changed.setData(fieldDragType, "unrelated-field");
  fieldDragEvent("drop", rows[1], changed, "before");
  expect(actions.moveField).not.toHaveBeenCalled();
  const sidebar = startFieldDrag(rows[0]);
  sidebar.types = ["application/x-inventory-manager-inventory"];
  fieldDragEvent("drop", rows[1], sidebar, "after");
  expect(actions.moveField).not.toHaveBeenCalled();
});

// Test that saving or a nested unfinished field editor prevents field reordering.
test("blocks dragging while reordering is unavailable", () => {
  const { actions } = renderDraftControl(<InventoryFieldsPanel />, {
    canReorder: false,
    fields: [field, { ...field, id: "other", name: "Other" }],
  });
  const rows = screen.getAllByRole("listitem");
  expect(rows[0]).toHaveAttribute("draggable", "false");
  expect(
    within(rows[0]).getByRole("button", { name: "Reorder Brand" }),
  ).toBeDisabled();
  dragField(rows[0], rows[1], "after");
  expect(actions.moveField).not.toHaveBeenCalled();
});

// Test that the grip is the only drag source; content, action buttons, and self-drops cannot reorder.
test("does not drag a field from its content, action buttons, or onto itself", () => {
  const { actions } = renderDraftControl(<InventoryFieldsPanel />, {
    fields: [field, { ...field, id: "other", name: "Other" }],
  });
  const rows = screen.getAllByRole("listitem");
  const transfer = startFieldDrag(rows[0]);
  fieldDragEvent("drop", rows[0], transfer, "before");
  expect(actions.moveField).not.toHaveBeenCalled();
  fireEvent.pointerDown(within(rows[0]).getByRole("button", { name: "Edit" }));
  fireEvent.dragStart(rows[0], { dataTransfer: transfer });
  fieldDragEvent("drop", rows[1], transfer, "after");
  fireEvent.dragStart(within(rows[0]).getByText("Brand"), {
    dataTransfer: transfer,
  });
  fieldDragEvent("drop", rows[1], transfer, "after");
  expect(actions.moveField).not.toHaveBeenCalled();
});
