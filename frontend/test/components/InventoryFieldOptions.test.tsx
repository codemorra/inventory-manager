import { useState } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { InventoryFieldOptions } from "../../src/components/InventoryFieldOptions";
import { field, option } from "../helpers/inventoryDraft";
afterEach(cleanup);

/**
 * Render controlled child-draft options without any inventory context or network actions.
 * @param disabled Whether option controls should be disabled.
 * @returns Spies for option changes and unfinished input.
 */
function renderOptions(disabled = false) {
  const change = vi.fn();
  const pending = vi.fn();
  // Mirror the field dialog's local option state.
  function Harness() {
    const [options, setOptions] = useState([option]);
    return (
      <InventoryFieldOptions
        fieldId={field.id}
        options={options}
        disabled={disabled}
        onChange={(next) => {
          change(next);
          setOptions(next);
        }}
        onPendingChange={pending}
      />
    );
  }
  render(<Harness />);
  return { change, pending };
}

// Test local creation and renaming without losing saved option identifiers.
test("adds and renames local options", async () => {
  const user = userEvent.setup();
  const { change } = renderOptions();
  await user.type(screen.getByLabelText("New option name"), " Strategy ");
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(change).toHaveBeenLastCalledWith([
    option,
    expect.objectContaining({ name: "Strategy", field_id: field.id }),
  ]);
  const row = screen.getByText("RPG").closest("li")!;
  await user.click(within(row).getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByLabelText("Option name"));
  await user.type(screen.getByLabelText("Option name"), "Role-playing game");
  await user.click(within(row).getByRole("button", { name: "Save" }));
  expect(change.mock.lastCall?.[0][0]).toEqual({
    ...option,
    name: "Role-playing game",
  });
});

// Test both paths of option deletion without changing the original data.
test.each(["Cancel", "Delete"])(
  "handles option deletion confirmation: %s",
  async (action) => {
    const user = userEvent.setup();
    const { change } = renderOptions();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(change).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete option" })).getByRole(
        "button",
        { name: action },
      ),
    );
    expect(change).toHaveBeenCalledTimes(action === "Delete" ? 1 : 0);
    if (action === "Delete") expect(change).toHaveBeenCalledWith([]);
  },
);

// Test child pending input and Enter handling without nested HTML forms.
test("reports pending input and handles Enter locally", async () => {
  const user = userEvent.setup();
  const { change, pending } = renderOptions();
  await user.type(screen.getByLabelText("New option name"), "New");
  expect(pending).toHaveBeenLastCalledWith(true);
  await user.keyboard("{Enter}");
  expect(change).toHaveBeenCalledOnce();
  expect(pending).toHaveBeenLastCalledWith(false);
  expect(document.querySelector("form")).not.toBeInTheDocument();
});

// Test option control availability during persistence.
test("disables option edits while saving", () => {
  renderOptions(true);
  expect(screen.getByRole("button", { name: "Edit" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  expect(screen.getByLabelText("New option name")).toBeDisabled();
});
