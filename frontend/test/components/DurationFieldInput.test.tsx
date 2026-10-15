import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { DurationFieldInput } from "../../src/components/DurationFieldInput";
import {
  durationFromSeconds,
  emptyDuration,
  maximumDurationHours,
} from "../../src/components/duration";
afterEach(cleanup);

/**
 * Render a controlled duration input in its unset, persisted, or disabled state.
 * @param seconds The saved duration or null for an unset value.
 * @param disabled Whether the controls are disabled while saving.
 * @returns The change spy for validating component values.
 */
function renderDuration(seconds: number | null = null, disabled = false) {
  const change = vi.fn();
  // Mirror the containing item's controlled value rather than persisting each component edit.
  function Harness() {
    const [value, setValue] = useState(
      seconds === null ? emptyDuration() : durationFromSeconds(seconds),
    );
    return (
      <DurationFieldInput
        id="duration"
        label="Usage time"
        required
        value={value}
        disabled={disabled}
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

// Test whole-component editing while preserving unset components and allowing hours beyond a day.
test("edits hours, minutes, and seconds without a 24-hour limit", async () => {
  const user = userEvent.setup();
  const change = renderDuration();
  expect(screen.getByRole("group", { name: "Usage time" })).toBeVisible();
  await user.type(screen.getByRole("spinbutton", { name: "Hours" }), "26");
  await user.type(screen.getByRole("spinbutton", { name: "Minutes" }), "15");
  await user.type(screen.getByRole("spinbutton", { name: "Seconds" }), "30");
  expect(change).toHaveBeenLastCalledWith({
    hours: "26",
    minutes: "15",
    seconds: "30",
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

// Test numeric filtering and bounds for the individual duration controls.
test("rejects invalid pasted minutes and seconds", async () => {
  const user = userEvent.setup();
  const change = renderDuration();
  for (const part of ["Minutes", "Seconds"]) {
    const input = screen.getByRole("spinbutton", { name: part });
    await user.click(input);
    await user.paste("60");
    expect(input).toHaveValue("");
    await user.paste("-1");
    expect(input).toHaveValue("");
  }
  expect(change).not.toHaveBeenCalled();
});

// Test persisted seconds and explicit zero are visible rather than replaced by blank defaults.
test.each([0, 94530])("restores a saved duration of %i seconds", (seconds) => {
  renderDuration(seconds);
  const expected = durationFromSeconds(seconds);
  expect(screen.getByRole("spinbutton", { name: "Hours" })).toHaveValue(
    expected.hours,
  );
  expect(screen.getByRole("spinbutton", { name: "Minutes" })).toHaveValue(
    expected.minutes,
  );
  expect(screen.getByRole("spinbutton", { name: "Seconds" })).toHaveValue(
    expected.seconds,
  );
});

// Test combined overflow even when every individual component is within its own range.
test("warns when the combined duration exceeds safe integer seconds", async () => {
  const user = userEvent.setup();
  renderDuration();
  await user.type(
    screen.getByRole("spinbutton", { name: "Hours" }),
    String(maximumDurationHours),
  );
  await user.type(screen.getByRole("spinbutton", { name: "Minutes" }), "59");
  expect(screen.getByRole("alert")).toHaveTextContent("too large");
});

// Test disabled inputs and step buttons while the containing item is being saved.
test("disables duration editing during a save", () => {
  renderDuration(null, true);
  for (const input of screen.getAllByRole("spinbutton"))
    expect(input).toBeDisabled();
  for (const button of screen.getAllByRole("button"))
    expect(button).toBeDisabled();
});
