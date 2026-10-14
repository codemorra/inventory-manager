import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { Modal } from "../../src/components/Modal";

afterEach(cleanup);

// Test that Escape dismisses only the topmost editor.
test("only dismisses the topmost dialog on Escape", () => {
  const closeParent = vi.fn();
  const closeChild = vi.fn();
  render(
    <Modal title="Inventory" onClose={closeParent}>
      <p>Parent</p>
    </Modal>,
  );
  render(
    <Modal title="Field" onClose={closeChild}>
      <p>Child</p>
    </Modal>,
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(closeChild).toHaveBeenCalledOnce();
  expect(closeParent).not.toHaveBeenCalled();
});

// Test that dialogs escape the fixed sidebar instead of inheriting its stacking context.
test("renders the overlay in the document body outside its sidebar parent", () => {
  const { container, unmount } = render(
    <aside className="fixed inset-y-0">
      <Modal title="Create inventory" onClose={vi.fn()}>
        <input aria-label="Inventory name" />
      </Modal>
    </aside>,
  );

  const dialog = screen.getByRole("dialog", { name: "Create inventory" });
  expect(container).not.toContainElement(dialog);
  expect(dialog.parentElement?.parentElement).toBe(document.body);
  expect(screen.getByLabelText("Inventory name")).toBeInTheDocument();
  unmount();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

// Test that moving dialogs into a portal preserves backdrop and Escape dismissal.
test("dismisses via Escape or backdrop but ignores clicks inside the dialog", () => {
  const onClose = vi.fn();
  render(
    <Modal title="Settings" onClose={onClose}>
      <p>Preferences</p>
    </Modal>,
  );
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  fireEvent.mouseDown(screen.getByText("Preferences"));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.mouseDown(dialog.parentElement!);
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(2);
});
