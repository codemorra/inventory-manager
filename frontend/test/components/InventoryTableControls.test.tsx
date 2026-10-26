import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { InventoryTableControls } from "../../src/components/InventoryTableControls";
import i18n from "../../src/i18n";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Test keyboard access to View and the direct item action without an inventory menu.
test("restores focus when View is dismissed and lets Tab reach the item action", async () => {
  const user = userEvent.setup();
  const create = vi.fn();
  render(
    <InventoryTableControls
      actions={<button onClick={create}>New item</button>}
      onWrapTextChange={vi.fn()}
    />,
  );
  const view = screen.getByRole("button", { name: "View" });
  await user.tab();
  expect(view).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Wrap text" }),
  ).toHaveFocus();
  await user.keyboard("{End}{ArrowDown}{Home}");
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Wrap text" }),
  ).toHaveFocus();
  expect(view).toHaveAttribute("aria-expanded", "true");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(view).toHaveFocus();
  await user.keyboard("{ArrowUp}{Escape}");
  await user.tab();
  expect(screen.getByRole("button", { name: "New item" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(create).toHaveBeenCalledOnce();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Inventory" }),
  ).not.toBeInTheDocument();
});

// Test that presentation controls expose their state without modifying inventory data.
test("toggles wrapping and shows the current checkbox state", async () => {
  const user = userEvent.setup();
  const wrap = vi.fn();
  const { rerender } = render(
    <InventoryTableControls itemCount={3} onWrapTextChange={wrap} wrapText />,
  );
  expect(screen.getByText("3 items")).toBeVisible();
  const view = screen.getByRole("button", { name: "View" });
  await user.click(view);
  const toggle = screen.getByRole("menuitemcheckbox", { name: "Wrap text" });
  expect(toggle).toBeChecked();
  await user.click(toggle);
  expect(wrap).toHaveBeenCalledExactlyOnceWith(false);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(view).toHaveFocus();
  rerender(
    <InventoryTableControls
      itemCount={3}
      onWrapTextChange={wrap}
      wrapText={false}
    />,
  );
  await user.click(view);
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Wrap text" }),
  ).not.toBeChecked();
});

// Test pointer dismissal, trigger toggling, and normal keyboard exit from portal menus.
test("closes on outside clicks and lets Tab reach the next control", async () => {
  const user = userEvent.setup();
  render(
    <>
      <InventoryTableControls
        onWrapTextChange={vi.fn()}
        actions={<button>New item</button>}
      />
      <button>Outside</button>
    </>,
  );
  const view = screen.getByRole("button", { name: "View" });
  await user.click(view);
  await user.click(view);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(view);
  await user.tab();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New item" })).toHaveFocus();
  await user.click(view);
  const outside = screen.getByRole("button", { name: "Outside" });
  await user.click(outside);
  expect(outside).toHaveFocus();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

// Test viewport constraints and dismissal when a scrolling table moves the anchor.
test("keeps menus inside the viewport and closes when the view moves", async () => {
  const user = userEvent.setup();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: window.innerWidth - 10,
    bottom: window.innerHeight - 10,
    width: 200,
    height: 100,
  } as DOMRect);
  render(<InventoryTableControls onWrapTextChange={vi.fn()} />);
  const trigger = screen.getByRole("button", { name: "View" });
  await user.click(trigger);
  expect(screen.getByRole("menu")).toHaveStyle({
    left: `${window.innerWidth - 208}px`,
    top: `${window.innerHeight - 108}px`,
  });
  fireEvent.scroll(window);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(trigger);
  fireEvent.resize(window);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

// Test localized labels and unavailable actions while writes are in progress.
test("translates the menus and disables actions when busy", async () => {
  const user = userEvent.setup();
  await i18n.changeLanguage("de");
  const props = { onWrapTextChange: vi.fn() };
  const { rerender } = render(<InventoryTableControls {...props} />);
  const bar = screen.getByRole("group", {
    name: "Steuerung der Inventartabelle",
  });
  await user.click(within(bar).getByRole("button", { name: "Ansicht" }));
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Zeilenumbruch" }),
  ).toBeChecked();
  rerender(<InventoryTableControls {...props} disabled />);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(within(bar).getByRole("button", { name: "Ansicht" })).toBeDisabled();
  rerender(<InventoryTableControls {...props} />);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
