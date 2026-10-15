import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { InventoryFieldCard } from "../../src/components/InventoryFieldCard";
import { renderDraftControl, field } from "../helpers/inventoryDraft";
afterEach(cleanup);

// Test the reuse preference is editable without changing the sequence or immutable field type.
test("adopts ID reuse changes only when the field edit is saved", async () => {
  const user = userEvent.setup();
  const automatic = {
    ...field,
    field_type: "id" as const,
    max_length: null,
    reuse_deleted_ids: false,
  };
  const { actions } = renderDraftControl(
    <InventoryFieldCard inventoryField={automatic} />,
  );
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(screen.queryByLabelText("Required field")).not.toBeInTheDocument();
  await user.click(screen.getByLabelText("Reuse numbers from deleted items"));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(actions.updateField).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(
    screen.getByLabelText("Reuse numbers from deleted items"),
  ).not.toBeChecked();
  await user.click(screen.getByLabelText("Reuse numbers from deleted items"));
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(actions.updateField).toHaveBeenCalledWith(field.id, {
    name: field.name,
    is_required: false,
    is_sortable: true,
    reuse_deleted_ids: true,
  });
});

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
  expect(actions.updateField).toHaveBeenCalledWith(field.id, {
    name: "Manufacturer",
    is_required: false,
    is_sortable: true,
  });
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
  expect(actions.updateField).not.toHaveBeenCalled();
});

// Test local field setting changes while immutable configuration stays unavailable.
test("edits field requirements and sorting without exposing type or limit changes", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(
    <InventoryFieldCard inventoryField={field} />,
  );
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(
    screen.getByRole("dialog", { name: "Edit inventory field" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Maximum length")).not.toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", { name: "Required field" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Allow column sorting" }),
  );
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(actions.updateField).toHaveBeenCalledWith(field.id, {
    name: field.name,
    is_required: true,
    is_sortable: false,
  });
});

// Test canceled child edits and reopening restore the current draft's settings.
test("discards canceled settings and reloads them on reopening", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(
    <InventoryFieldCard
      inventoryField={{ ...field, is_required: true, is_sortable: false }}
    />,
  );
  expect(screen.getByText("Required field")).toBeVisible();
  expect(screen.getByText("Sorting disabled")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  await user.click(screen.getByRole("checkbox", { name: "Required field" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Allow column sorting" }),
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(actions.updateField).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Edit" }));
  expect(
    screen.getByRole("checkbox", { name: "Required field" }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Allow column sorting" }),
  ).not.toBeChecked();
});
