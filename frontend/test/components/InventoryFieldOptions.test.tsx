import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { InventoryFieldOptions } from "../../src/components/InventoryFieldOptions";
import { renderDraftControl, field, option } from "../helpers/inventoryDraft";
afterEach(cleanup);

// Test local creation and renaming without issuing a persistence operation.
test("adds and renames local options", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(
    <InventoryFieldOptions fieldId={field.id} options={[option]} />,
  );
  await user.type(screen.getByLabelText("New option name"), " Strategy ");
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(actions.addOption).toHaveBeenCalledWith(field.id, "Strategy");
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByLabelText("Option name"));
  await user.type(screen.getByLabelText("Option name"), "Role-playing game");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(actions.renameOption).toHaveBeenCalledWith(
    field.id,
    option.id,
    "Role-playing game",
  );
});

// Test both paths of option deletion without changing the original data.
test.each(["Cancel", "Delete"])(
  "handles option deletion confirmation: %s",
  async (action) => {
    const user = userEvent.setup();
    const { actions } = renderDraftControl(
      <InventoryFieldOptions fieldId={field.id} options={[option]} />,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(actions.removeOption).not.toHaveBeenCalled();
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete option" })).getByRole(
        "button",
        { name: action },
      ),
    );
    expect(actions.removeOption).toHaveBeenCalledTimes(
      action === "Delete" ? 1 : 0,
    );
    if (action === "Delete")
      expect(actions.removeOption).toHaveBeenCalledWith(field.id, option.id);
  },
);

// Test that unfinished inline input is announced to the parent editor.
test("locks the parent save while option input is unfinished", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(
    <InventoryFieldOptions fieldId={field.id} options={[option]} />,
  );
  await user.type(screen.getByLabelText("New option name"), "New");
  expect(actions.setPendingEditor).toHaveBeenLastCalledWith(
    "options-field-1",
    true,
  );
  await user.click(screen.getByRole("button", { name: "Add" }));
  expect(actions.setPendingEditor).toHaveBeenLastCalledWith(
    "options-field-1",
    false,
  );
});
