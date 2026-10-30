import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ChoiceSelect } from "../../src/components/ChoiceSelect";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const options = [
  { value: "a", label: "First" },
  { value: "b", label: "Second" },
];

/**
 * Render a controlled multi-choice dropdown with an optional empty option list.
 * @param empty Whether no choices have been configured.
 * @param portal Whether the list should escape its clipping ancestors.
 * @returns The value change spy.
 */
function renderChoices(empty = false, portal = false) {
  const change = vi.fn();
  // Reflect each toggle while preserving the popup's keyboard focus.
  function Harness() {
    const [value, setValue] = useState<string[]>([]);
    return (
      <ChoiceSelect
        id="choices"
        label="Choices"
        multiple
        portal={portal}
        required
        options={empty ? [] : options}
        value={value}
        emptyLabel="No selection"
        onChange={(next) => {
          change(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  return change;
}

// Test selecting and deselecting multiple options without modifier keys or closing the popup.
test("toggles options and shows selected labels without closing", async () => {
  const user = userEvent.setup();
  const change = renderChoices();
  const control = screen.getByRole("combobox", { name: "Choices" });
  expect(control).toHaveAttribute("aria-required", "true");
  await user.click(control);
  expect(screen.getByRole("listbox")).toHaveAttribute(
    "aria-multiselectable",
    "true",
  );
  await user.click(screen.getByRole("option", { name: "First" }));
  await user.click(screen.getByRole("option", { name: "Second" }));
  expect(change).toHaveBeenLastCalledWith(["a", "b"]);
  expect(control).toHaveTextContent("First, Second");
  expect(control).toHaveAttribute("aria-expanded", "true");
  await user.click(screen.getByRole("option", { name: "First" }));
  expect(change).toHaveBeenLastCalledWith(["b"]);
  expect(screen.getByRole("option", { name: "First" })).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await user.click(screen.getByRole("option", { name: "Second" }));
  expect(control).toHaveTextContent("No selection");
});

// Test option portals escape clipping ancestors while retaining selection and outside dismissal.
test("keeps a portalled multiple-choice popup open while selecting and scrolling", async () => {
  const user = userEvent.setup();
  const change = renderChoices(false, true);
  const control = screen.getByRole("combobox");
  await user.click(control);
  const popup = screen.getByRole("listbox");
  expect(popup.parentElement).toBe(document.body);
  expect(control.parentElement?.contains(popup)).toBe(false);
  await user.click(screen.getByRole("option", { name: "First" }));
  fireEvent.scroll(popup);
  await user.click(screen.getByRole("option", { name: "Second" }));
  expect(change).toHaveBeenLastCalledWith(["a", "b"]);
  expect(control).toHaveFocus();
  expect(control).toHaveAttribute("aria-expanded", "true");
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

// Test window edges, upward placement and following an anchor moved by panel scrolling.
test("positions a popup against the viewport instead of its clipping ancestor", async () => {
  const user = userEvent.setup();
  let anchorBottom = 134;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return this.getAttribute("role") === "combobox"
        ? ({
            left: window.innerWidth - 100,
            top: anchorBottom - 34,
            bottom: anchorBottom,
            width: 80,
            height: 34,
          } as DOMRect)
        : ({ width: 280, height: 160 } as DOMRect);
    },
  );
  render(
    <div data-testid="scroller" style={{ overflow: "hidden", height: 40 }}>
      <ChoiceSelect
        id="portal"
        label="Choices"
        portal
        options={options}
        value="a"
        onChange={vi.fn()}
      />
    </div>,
  );
  await user.click(screen.getByRole("combobox"));
  const popup = screen.getByRole("listbox");
  expect(popup).toHaveStyle({
    left: `${window.innerWidth - 288}px`,
    top: "138px",
    minWidth: "80px",
    maxWidth: `${window.innerWidth - 16}px`,
  });
  anchorBottom = 200;
  fireEvent.scroll(screen.getByTestId("scroller"));
  expect(popup).toHaveStyle({ top: "204px" });
  anchorBottom = window.innerHeight - 10;
  fireEvent.resize(window);
  expect(popup).toHaveStyle({
    top: `${window.innerHeight - 208}px`,
    maxHeight: "192px",
  });
  expect(popup.parentElement).toBe(document.body);
});

// Test keyboard navigation scrolls only the list, preserving its panel and the underlying page.
test("scrolls a portalled list itself during keyboard navigation", async () => {
  const user = userEvent.setup();
  renderChoices(false, true);
  const control = screen.getByRole("combobox");
  await user.click(control);
  const popup = screen.getByRole("listbox");
  const second = screen.getByRole("option", { name: "Second" });
  Object.defineProperty(popup, "clientHeight", { value: 96 });
  Object.defineProperty(second, "offsetTop", { value: 200 });
  Object.defineProperty(second, "offsetHeight", { value: 32 });
  const scrollIntoView = vi.fn();
  second.scrollIntoView = scrollIntoView;
  await user.keyboard("{End}");
  expect(popup.scrollTop).toBe(136);
  expect(scrollIntoView).not.toHaveBeenCalled();
  await user.keyboard("{Home}");
  expect(popup.scrollTop).toBe(0);
  await user.keyboard("{Escape}");
  expect(control).toHaveFocus();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

// Test multiple keyboard toggles while keeping the active option distinct from selected options.
test("supports keyboard toggling and Escape without committing an extra choice", async () => {
  const user = userEvent.setup();
  const change = renderChoices();
  const control = screen.getByRole("combobox");
  control.focus();
  await user.keyboard("{ArrowDown}{Enter}{ArrowDown} {Escape}");
  expect(change).toHaveBeenLastCalledWith(["a", "b"]);
  expect(change).toHaveBeenCalledTimes(2);
  expect(control).toHaveAttribute("aria-expanded", "false");
});

// Test a disabled empty dropdown instead of exposing an unusable option popup.
test("disables the dropdown when there are no available options", () => {
  renderChoices(true);
  expect(screen.getByRole("combobox")).toBeDisabled();
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});

test("only highlights keyboard navigation and follows the hovered option", async () => {
  const user = userEvent.setup();
  renderChoices();
  const control = screen.getByRole("combobox", { name: "Choices" });
  await user.click(control);
  const first = screen.getByRole("option", { name: "First" });
  const second = screen.getByRole("option", { name: "Second" });
  expect(first).not.toHaveClass("bg-control-hover");
  await user.hover(second);
  expect(control).toHaveAttribute("aria-activedescendant", second.id);
  expect(first).not.toHaveClass("bg-control-hover");
  await user.keyboard("{Home}");
  expect(first).toHaveClass("bg-control-hover");
  await user.hover(first);
  await user.hover(second);
  expect(first).not.toHaveClass("bg-control-hover");
  await user.keyboard("{Enter}");
  expect(second).toHaveAttribute("aria-selected", "true");
});
