import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { InventoryFieldCard } from "../../src/components/InventoryFieldCard";
import { renderDraftControl, field } from "../helpers/inventoryDraft";
afterEach(cleanup);

// Test that renaming retains the saved identifier and immutable field definition.
test("renames a field only in the draft", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(
    <InventoryFieldCard inventoryField={field} />,
  );
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.clear(screen.getByLabelText("Field name"));
  await user.type(screen.getByLabelText("Field name"), "Manufacturer");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(actions.renameField).toHaveBeenCalledWith(field.id, "Manufacturer");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

// Test both paths of the local deletion confirmation.
test.each(["Cancel", "Delete"])(
  "handles field deletion confirmation: %s",
  async (action) => {
    const user = userEvent.setup();
    const { actions } = renderDraftControl(
      <InventoryFieldCard inventoryField={field} />,
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(actions.removeField).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", {
      name: "Delete inventory field",
    });
    await user.click(within(dialog).getByRole("button", { name: action }));
    expect(actions.removeField).toHaveBeenCalledTimes(
      action === "Delete" ? 1 : 0,
    );
    if (action === "Delete")
      expect(actions.removeField).toHaveBeenCalledWith(field.id);
  },
);

// Test that canceling a rename keeps the original field draft.
test("cancels a field rename", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(
    <InventoryFieldCard inventoryField={field} />,
  );
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.type(screen.getByLabelText("Field name"), " changed");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(actions.renameField).not.toHaveBeenCalled();
});
