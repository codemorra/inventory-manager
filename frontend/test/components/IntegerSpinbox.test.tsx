import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { IntegerSpinbox } from "../../src/components/IntegerSpinbox";
import i18n from "../../src/i18n";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * Render a controlled spinbox inside a form to detect accidental submissions.
 * @param initial The starting integer string or an empty value.
 * @param disabled Whether the control is disabled.
 * @returns Spies for accepted values and form submissions.
 */
function renderSpinbox(initial = "255", disabled = false) {
  const change = vi.fn();
  const submit = vi.fn();
  // Keep the control's value managed by its parent, as in the field creation form.
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <IntegerSpinbox
          id="length"
          label="Maximum length"
          describedBy="help"
          min={1}
          max={1000}
          value={value}
          disabled={disabled}
          required
          onChange={(next) => {
            change(next);
            setValue(next);
          }}
        />
        <p id="help">1 to 1,000 characters.</p>
      </form>
    );
  }
  const view = render(<Harness />);
  return { ...view, change, submit };
}

// Test pointer stepping, focus retention, accessible numeric state, and non-submitting buttons.
test("steps by one through the themed arrows without submitting", async () => {
  const user = userEvent.setup();
  const { change, submit } = renderSpinbox();
  const input = screen.getByRole("spinbutton", { name: "Maximum length" });
  expect(input).toHaveAccessibleDescription("1 to 1,000 characters.");
  expect(input.parentElement).toHaveClass("w-24");
  expect(input).toHaveClass("text-sm", "py-1.5");
  await user.click(
    screen.getByRole("button", { name: "Increase Maximum length" }),
  );
  expect(input).toHaveValue("256");
  expect(input).toHaveAttribute("aria-valuenow", "256");
  expect(input).toHaveFocus();
  await user.click(
    screen.getByRole("button", { name: "Decrease Maximum length" }),
  );
  expect(change).toHaveBeenLastCalledWith("255");
  expect(submit).not.toHaveBeenCalled();
});

// Test a press-and-hold sequence without stale values, double clicks, or form submission.
test("repeats a held arrow after a delay and does not add a release click step", () => {
  vi.useFakeTimers();
  const { change, submit } = renderSpinbox();
  const input = screen.getByRole("spinbutton");
  const up = screen.getByRole("button", { name: "Increase Maximum length" });
  fireEvent.pointerDown(up, { button: 0, isPrimary: true });
  expect(input).toHaveValue("256");
  act(() => vi.advanceTimersByTime(399));
  expect(input).toHaveValue("256");
  act(() => vi.advanceTimersByTime(226));
  expect(input).toHaveValue("260");
  fireEvent.pointerUp(up);
  fireEvent.click(up, { detail: 1 });
  act(() => vi.advanceTimersByTime(1000));
  expect(input).toHaveValue("260");
  expect(change).toHaveBeenCalledTimes(5);
  expect(submit).not.toHaveBeenCalled();
});

// Test cleanup for every way a held pointer or the browser window can become inactive.
test.each(["release", "leave", "cancel", "blur"])(
  "stops repeating on %s",
  (reason) => {
    vi.useFakeTimers();
    renderSpinbox();
    const down = screen.getByRole("button", {
      name: "Decrease Maximum length",
    });
    fireEvent.pointerDown(down, { button: 0, isPrimary: true });
    act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole("spinbutton")).toHaveValue("253");
    if (reason === "release") fireEvent.pointerUp(window);
    else if (reason === "leave") fireEvent.pointerLeave(down);
    else if (reason === "cancel") fireEvent.pointerCancel(window);
    else fireEvent.blur(window);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("spinbutton")).toHaveValue("253");
    expect(vi.getTimerCount()).toBe(0);
  },
);

// Test automatic stopping at either bound and cleanup when the containing dialog unmounts.
test.each([
  ["999", "Increase Maximum length", "1000"],
  ["2", "Decrease Maximum length", "1"],
])("stops holding from %s at the boundary", (initial, label, boundary) => {
  vi.useFakeTimers();
  const { change, unmount } = renderSpinbox(initial);
  fireEvent.pointerDown(screen.getByRole("button", { name: label }), {
    button: 0,
    isPrimary: true,
  });
  act(() => vi.advanceTimersByTime(1500));
  expect(screen.getByRole("spinbutton")).toHaveValue(boundary);
  expect(change).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

// Test that closing a dialog while holding an arrow cannot continue mutating its draft.
test("clears an active hold timer on unmount", () => {
  vi.useFakeTimers();
  const { change, unmount } = renderSpinbox();
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Increase Maximum length" }),
    { button: 0, isPrimary: true },
  );
  unmount();
  act(() => vi.advanceTimersByTime(1000));
  expect(change).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

// Test wheel stepping on hover without stealing focus or scrolling the surrounding page.
test("steps with the wheel while hovered and cancels page scrolling", () => {
  renderSpinbox();
  const input = screen.getByRole("spinbutton");
  const up = new WheelEvent("wheel", {
    deltaY: -100,
    bubbles: true,
    cancelable: true,
  });
  fireEvent(input, up);
  expect(input).toHaveValue("256");
  expect(up.defaultPrevented).toBe(true);
  expect(input).not.toHaveFocus();
  const down = new WheelEvent("wheel", {
    deltaY: 100,
    bubbles: true,
    cancelable: true,
  });
  fireEvent(input, down);
  expect(input).toHaveValue("255");
  expect(down.defaultPrevented).toBe(true);
  fireEvent.wheel(input, { deltaY: -100, ctrlKey: true });
  fireEvent.wheel(input, { deltaY: -100, metaKey: true });
  fireEvent.wheel(input, { deltaY: 0, deltaX: 100 });
  expect(input).toHaveValue("255");
});

// Test wheel limits and disabled controls rather than bypassing the same integer constraints.
test.each([
  ["1", 100],
  ["1000", -100],
])("keeps wheel input within the boundary %s", (initial, deltaY) => {
  const { change } = renderSpinbox(initial);
  fireEvent.wheel(screen.getByRole("spinbutton"), { deltaY });
  expect(screen.getByRole("spinbutton")).toHaveValue(initial);
  expect(change).not.toHaveBeenCalled();
});

// Test both boundaries using pointer and keyboard controls without wrapping around.
test("supports arrow keys, Home, and End while enforcing the range", async () => {
  const user = userEvent.setup();
  renderSpinbox();
  const input = screen.getByRole("spinbutton");
  input.focus();
  await user.keyboard("{ArrowUp}");
  expect(input).toHaveValue("256");
  await user.keyboard("{ArrowDown}{Home}{ArrowDown}");
  expect(input).toHaveValue("1");
  expect(
    screen.getByRole("button", { name: "Decrease Maximum length" }),
  ).toBeDisabled();
  await user.keyboard("{End}{ArrowUp}");
  expect(input).toHaveValue("1000");
  expect(
    screen.getByRole("button", { name: "Increase Maximum length" }),
  ).toBeDisabled();
});

// Test a deterministic starting point when a temporarily empty control is stepped.
test.each(["ArrowUp", "ArrowDown"])(
  "starts an empty input at the minimum with %s",
  async (key) => {
    const user = userEvent.setup();
    renderSpinbox("");
    const input = screen.getByRole("spinbutton");
    expect(input).not.toHaveAttribute("aria-valuenow");
    input.focus();
    await user.keyboard(`{${key}}`);
    expect(input).toHaveValue("1");
  },
);

// Test that only decimal digits and values in range are accepted from clipboard input.
test.each(["abc", "1e2", "1.5", "-1", "+1", "1001", "0"])(
  "rejects invalid pasted input %s",
  async (text) => {
    const user = userEvent.setup();
    const { change } = renderSpinbox("");
    const input = screen.getByRole("spinbutton");
    await user.click(input);
    await user.paste(text);
    expect(input).toHaveValue("");
    expect(change).not.toHaveBeenCalled();
  },
);

// Test disabled state and translated action labels without changing the numeric value.
test("disables every control and translates arrow labels", async () => {
  await i18n.changeLanguage("de");
  const user = userEvent.setup();
  const { change } = renderSpinbox("255", true);
  expect(screen.getByRole("spinbutton")).toBeDisabled();
  const up = screen.getByRole("button", { name: "Maximum length erhöhen" });
  expect(up).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Maximum length verringern" }),
  ).toBeDisabled();
  await user.click(up);
  fireEvent.wheel(screen.getByRole("spinbutton"), { deltaY: -100 });
  expect(change).not.toHaveBeenCalled();
});
