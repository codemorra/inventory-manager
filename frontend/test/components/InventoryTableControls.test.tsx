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

// Test the inventory-wide Auto action reflects derived state but always remains usable.
test("keeps Automatic widths actionable in both checked and unchecked states", async () => {
  const user = userEvent.setup();
  const automatic = vi.fn();
  const { rerender } = render(
    <InventoryTableControls
      onAutomaticWidths={automatic}
      allColumnsAutomatic
    />,
  );
  await user.click(screen.getByRole("button", { name: "View" }));
  const checked = screen.getByRole("menuitemcheckbox", {
    name: "Automatic widths",
  });
  expect(checked).toBeChecked();
  expect(checked).toBeEnabled();
  await user.click(checked);
  expect(automatic).toHaveBeenCalledOnce();
  rerender(
    <InventoryTableControls
      onAutomaticWidths={automatic}
      allColumnsAutomatic={false}
    />,
  );
  await user.click(screen.getByRole("button", { name: "View" }));
  const unchecked = screen.getByRole("menuitemcheckbox", {
    name: "Automatic widths",
  });
  expect(unchecked).not.toBeChecked();
  expect(unchecked).toBeEnabled();
  await user.click(unchecked);
  expect(automatic).toHaveBeenCalledTimes(2);
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

// Test column selection skips unavailable actions and remains open while choosing or scrolling.
test("keeps column selection open, skips the last visible column, and allows menu scrolling", async () => {
  const user = userEvent.setup();
  const toggle = vi.fn();
  render(
    <InventoryTableControls
      onWrapTextChange={vi.fn()}
      onToggleColumn={toggle}
      columns={[
        { id: "first", name: "Title", visible: true },
        { id: "second", name: "Notes", visible: false },
      ]}
    />,
  );
  await user.click(screen.getByRole("button", { name: "View" }));
  expect(
    screen.queryByRole("menuitemcheckbox", { name: "Title" }),
  ).not.toBeInTheDocument();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "Columns" })).toHaveFocus();
  await user.keyboard("{ArrowRight}");
  const title = screen.getByRole("menuitemcheckbox", { name: "Title" });
  expect(title).toBeDisabled();
  expect(title).toHaveAttribute(
    "title",
    "At least one column must remain visible.",
  );
  const notes = screen.getByRole("menuitemcheckbox", { name: "Notes" });
  expect(notes).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(toggle).toHaveBeenCalledExactlyOnceWith("second");
  expect(screen.getByRole("menu", { name: "Columns" })).toBeVisible();
  fireEvent.scroll(screen.getByRole("menu", { name: "Columns" }));
  expect(screen.getByRole("menu", { name: "Columns" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(
    screen.queryByRole("menu", { name: "Columns" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Columns" })).toHaveFocus();
  expect(screen.getByRole("menu", { name: "View" })).toBeVisible();
  await user.keyboard("{ArrowRight}{ArrowLeft}");
  expect(screen.getByRole("menuitem", { name: "Columns" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "View" })).toHaveFocus();
});

// Test a tall submenu opens away from the viewport edge and keeps every column reachable.
test("positions a long column submenu inside the viewport and exits it with Tab", async () => {
  const user = userEvent.setup();
  const toggle = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this.getAttribute("role") === "menuitem")
        return {
          left: window.innerWidth - 220,
          right: window.innerWidth - 20,
          top: window.innerHeight - 60,
          width: 200,
          height: 36,
        } as DOMRect;
      if (this.getAttribute("aria-label") === "Columns")
        return { width: 200, height: 500 } as DOMRect;
      return { left: 8, bottom: 40, width: 200, height: 80 } as DOMRect;
    },
  );
  render(
    <InventoryTableControls
      onWrapTextChange={vi.fn()}
      onToggleColumn={toggle}
      columns={Array.from({ length: 80 }, (_, index) => ({
        id: String(index),
        name: `Column ${index + 1}`,
        visible: true,
      }))}
      actions={<button>New item</button>}
    />,
  );
  await user.click(screen.getByRole("button", { name: "View" }));
  await user.click(screen.getByRole("menuitem", { name: "Columns" }));
  const submenu = screen.getByRole("menu", { name: "Columns" });
  expect(submenu).toHaveStyle({
    left: `${window.innerWidth - 424}px`,
    top: `${window.innerHeight - 508}px`,
  });
  await user.keyboard("{End}");
  expect(
    screen.getByRole("menuitemcheckbox", { name: "Column 80" }),
  ).toHaveFocus();
  fireEvent.scroll(submenu);
  await user.keyboard("{Enter}");
  expect(toggle).toHaveBeenCalledExactlyOnceWith("79");
  expect(submenu).toBeVisible();
  await user.tab();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New item" })).toHaveFocus();
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
