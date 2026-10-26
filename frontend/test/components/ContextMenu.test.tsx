import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ContextMenu } from "../../src/components/ContextMenu";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Test marked actions stay selectable while unavailable actions are skipped by keyboard navigation.
test("shows checked state, skips disabled actions, and keeps internal scrolling available", async () => {
  const user = userEvent.setup();
  const automatic = vi.fn();
  const close = vi.fn();
  render(
    <ContextMenu
      x={20}
      y={20}
      label="Column Title"
      onClose={close}
      actions={[
        { label: "Automatic width", checked: true, onSelect: automatic },
        { label: "Hide column", disabled: true, onSelect: vi.fn() },
        { label: "Other action", onSelect: vi.fn() },
      ]}
    />,
  );
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Automatic width" }),
  ).toBeChecked();
  expect(screen.getByRole("menuitem", { name: "Hide column" })).toBeDisabled();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Other action" })).toHaveFocus();
  await user.keyboard("{Home}{Enter}");
  expect(automatic).toHaveBeenCalledOnce();
  fireEvent.scroll(screen.getByRole("menu"));
  expect(close).not.toHaveBeenCalled();
  fireEvent.scroll(window);
  expect(close).toHaveBeenCalledOnce();
});

// Test keyboard action selection and Escape dismissal.
test("focuses menu actions and handles keyboard navigation", async () => {
  const user = userEvent.setup();
  const select = vi.fn();
  const close = vi.fn();
  render(
    <ContextMenu
      x={10}
      y={10}
      label="Actions"
      onClose={close}
      actions={[
        { label: "Edit", onSelect: select },
        { label: "Delete", onSelect: vi.fn() },
      ]}
    />,
  );
  expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus();
  await user.keyboard("{Home}{Enter}");
  expect(select).toHaveBeenCalledOnce();
  await user.keyboard("{Escape}");
  expect(close).toHaveBeenCalledOnce();
});

// Test that the menu fits within the viewport even when opened at its lower edge.
test("keeps the menu inside the viewport and dismisses outside clicks", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 200,
    height: 100,
  } as DOMRect);
  const close = vi.fn();
  render(
    <ContextMenu
      x={window.innerWidth}
      y={window.innerHeight}
      label="Actions"
      onClose={close}
      actions={[{ label: "Edit", onSelect: vi.fn() }]}
    />,
  );
  const menu = screen.getByRole("menu");
  expect(menu).toHaveStyle({
    left: `${window.innerWidth - 208}px`,
    top: `${window.innerHeight - 108}px`,
  });
  fireEvent.pointerDown(menu);
  expect(close).not.toHaveBeenCalled();
  fireEvent.pointerDown(document.body);
  expect(close).toHaveBeenCalledOnce();
});
