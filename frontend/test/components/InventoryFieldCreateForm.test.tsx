import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { InventoryFieldCreateForm } from "../../src/components/InventoryFieldCreateForm";
import { renderDraftControl } from "../helpers/inventoryDraft";
afterEach(cleanup);

// Test that field submission changes only the local draft and resets the child form.
test("adds a trimmed text field locally and resets its inputs", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(<InventoryFieldCreateForm />);
  await user.click(screen.getByRole("button", { name: "New field" }));
  await user.type(screen.getByLabelText("Field name"), "  Brand  ");
  await user.click(screen.getByRole("button", { name: "Add field" }));
  expect(actions.addField).toHaveBeenCalledWith({
    name: "Brand",
    field_type: "text",
    max_length: 255,
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "New field" }));
  expect(screen.getByLabelText("Field name")).toHaveValue("");
});

// Test that initial options belong to the new field draft.
test("adds a selection field with its options", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(<InventoryFieldCreateForm />);
  await user.click(screen.getByRole("button", { name: "New field" }));
  await user.type(screen.getByLabelText("Field name"), "Played");
  await user.selectOptions(screen.getByLabelText("Field type"), "select");
  await user.type(screen.getByLabelText("Option 1"), "Not started");
  await user.click(screen.getByRole("button", { name: "Add option" }));
  await user.type(screen.getByLabelText("Option 2"), "Completed");
  await user.click(screen.getByRole("button", { name: "Add field" }));
  expect(actions.addField).toHaveBeenCalledWith({
    name: "Played",
    field_type: "select",
    options: [{ name: "Not started" }, { name: "Completed" }],
  });
});

// Test that canceling a child form does not add a field to the session.
test("discards the child form on cancel", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(<InventoryFieldCreateForm />);
  await user.click(screen.getByRole("button", { name: "New field" }));
  await user.type(screen.getByLabelText("Field name"), "Unused");
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(actions.addField).not.toHaveBeenCalled();
});

// Test that an active atomic save disables new field creation.
test("disables field creation while the parent is saving", () => {
  renderDraftControl(<InventoryFieldCreateForm />, { disabled: true });
  expect(screen.getByRole("button", { name: "New field" })).toBeDisabled();
});
