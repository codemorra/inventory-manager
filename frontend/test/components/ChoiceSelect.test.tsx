import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ChoiceSelect } from "../../src/components/ChoiceSelect";
afterEach(cleanup);

const options = [
  { value: "a", label: "First" },
  { value: "b", label: "Second" },
];

/**
 * Render a controlled multi-choice dropdown with an optional empty option list.
 * @param empty Whether no choices have been configured.
 * @returns The value change spy.
 */
function renderChoices(empty = false) {
  const change = vi.fn();
  // Reflect each toggle while preserving the popup's keyboard focus.
  function Harness() {
    const [value, setValue] = useState<string[]>([]);
    return (
      <ChoiceSelect
        id="choices"
        label="Choices"
        multiple
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
