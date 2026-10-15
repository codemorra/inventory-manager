import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SingleSelect } from "../../src/components/SingleSelect";
import { Modal } from "../../src/components/Modal";
afterEach(cleanup);

const options = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "select", label: "Single choice" },
];

/**
 * Render a controlled dropdown inside a dismissible modal.
 * @param disabled Whether selection is disabled.
 * @returns Spies for committed values and modal dismissal.
 */
function renderSelect(disabled = false) {
  const change = vi.fn();
  const close = vi.fn();
  // Retain the committed value independently of the highlighted option.
  function Harness() {
    const [value, setValue] = useState("text");
    return (
      <Modal title="Field" onClose={close}>
        <p id="help">Choose a type.</p>
        <SingleSelect
          id="type"
          label="Field type"
          describedBy="help"
          options={options}
          value={value}
          disabled={disabled}
          onChange={(next) => {
            change(next);
            setValue(next);
          }}
        />
        <button type="button">Outside</button>
      </Modal>
    );
  }
  render(<Harness />);
  return { change, close };
}

// Test a themed option popup and controlled value changes without submitting a form.
test("selects an option by pointer and returns focus to the combobox", async () => {
  const user = userEvent.setup();
  const { change } = renderSelect();
  const select = screen.getByRole("combobox", { name: "Field type" });
  expect(select).toHaveAccessibleDescription("Choose a type.");
  await user.click(select);
  expect(screen.getByRole("listbox")).toHaveClass("bg-surface", "border-shell");
  expect(screen.getByRole("option", { name: "Text" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.click(screen.getByRole("option", { name: "Number" }));
  expect(change).toHaveBeenCalledWith("number");
  expect(select).toHaveTextContent("Number");
  expect(select).toHaveFocus();
  expect(select).toHaveAttribute("aria-expanded", "false");
});

// Test navigation, typeahead, and dismissal without accidental value or modal changes.
test("supports keyboard navigation, typeahead, Escape, and Tab", async () => {
  const user = userEvent.setup();
  const { change, close } = renderSelect();
  const select = screen.getByRole("combobox");
  select.focus();
  await user.keyboard("{ArrowDown}{End}{Home}{ArrowDown}{Enter}");
  expect(change).toHaveBeenLastCalledWith("number");
  await user.keyboard("s{Enter}");
  expect(change).toHaveBeenLastCalledWith("select");
  await user.keyboard("{ArrowUp}{Escape}");
  expect(select).toHaveAttribute("aria-expanded", "false");
  expect(close).not.toHaveBeenCalled();
  expect(change).toHaveBeenCalledTimes(2);
  await user.keyboard("{ArrowDown}{Tab}");
  expect(select).toHaveAttribute("aria-expanded", "false");
  expect(screen.getByRole("button", { name: "Outside" })).toHaveFocus();
});

// Test closing an open popup when interacting elsewhere in the dialog.
test("dismisses on an outside pointer without selecting", async () => {
  const user = userEvent.setup();
  const { change } = renderSelect();
  await user.click(screen.getByRole("combobox"));
  await user.click(screen.getByRole("button", { name: "Outside" }));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
});

// Test that an in-progress save prevents opening the option list.
test("does not open when disabled", async () => {
  const user = userEvent.setup();
  renderSelect(true);
  expect(screen.getByRole("combobox")).toBeDisabled();
  await user.click(screen.getByRole("combobox"));
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
});
