import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { InventoryFieldCreateForm } from "../../src/components/InventoryFieldCreateForm";
import { renderDraftControl } from "../helpers/inventoryDraft";
import i18n from "../../src/i18n";
afterEach(cleanup);

// Test that type-specific options share the same settings box as requirements and sorting.
test("groups the text limit and selection options inside field settings", async () => {
  const user = userEvent.setup();
  renderDraftControl(<InventoryFieldCreateForm />);
  await user.click(screen.getByRole("button", { name: "New field" }));
  const settings = screen.getByRole("group", { name: "Field settings" });
  expect(within(settings).getByLabelText("Maximum length")).toBeVisible();
  expect(settings.querySelector(".border-b")).toBeInTheDocument();
  expect(
    within(settings).getByRole("checkbox", { name: "Required field" }),
  ).toBeVisible();
  expect(
    within(settings).getByRole("checkbox", { name: "Allow column sorting" }),
  ).toBeVisible();
  for (const type of ["select", "multiselect"]) {
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Field type" }),
      type,
    );
    expect(
      within(settings).queryByLabelText("Maximum length"),
    ).not.toBeInTheDocument();
    expect(
      within(settings).getByRole("group", { name: "Options" }),
    ).toBeVisible();
    expect(within(settings).getByLabelText("Option 1")).toBeVisible();
    expect(settings.querySelector(".border-b")).toBeInTheDocument();
    expect(
      within(settings).getByRole("button", { name: "Add option" }),
    ).toBeVisible();
  }
  // Conditional JSX still supplies an array of false children for these types.
  for (const type of [
    "number",
    "boolean",
    "date",
    "time",
    "datetime",
    "duration",
  ]) {
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Field type" }),
      type,
    );
    expect(settings.querySelector(".border-b")).not.toBeInTheDocument();
  }
  expect(
    within(settings).queryByRole("group", { name: "Options" }),
  ).not.toBeInTheDocument();
  expect(
    within(settings).getByRole("checkbox", { name: "Required field" }),
  ).toBeVisible();
});

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
    is_required: false,
    is_sortable: true,
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
    is_required: false,
    is_sortable: true,
    options: [{ name: "Not started" }, { name: "Completed" }],
  });
});

// Test that canceling a child form does not add a field to the session.
test("discards the child form on cancel", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(<InventoryFieldCreateForm />);
  await user.click(screen.getByRole("button", { name: "New field" }));
  await user.type(screen.getByLabelText("Field name"), "Unused");
  await user.click(screen.getByRole("checkbox", { name: "Required field" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Allow column sorting" }),
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(actions.addField).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "New field" }));
  expect(screen.getByLabelText("Field name")).toHaveValue("");
  expect(
    screen.getByRole("checkbox", { name: "Required field" }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Allow column sorting" }),
  ).toBeChecked();
});

// Test that an active atomic save disables new field creation.
test("disables field creation while the parent is saving", () => {
  renderDraftControl(<InventoryFieldCreateForm />, { disabled: true });
  expect(screen.getByRole("button", { name: "New field" })).toBeDisabled();
});

// Test configurable requirements and sortability and reset after adding the field.
test("stages chosen field settings and resets them after adding", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(<InventoryFieldCreateForm />);
  await user.click(screen.getByRole("button", { name: "New field" }));
  expect(
    screen.getByRole("checkbox", { name: "Required field" }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Allow column sorting" }),
  ).toBeChecked();
  await user.type(screen.getByLabelText("Field name"), "Title");
  await user.click(screen.getByRole("checkbox", { name: "Required field" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Allow column sorting" }),
  );
  await user.click(screen.getByRole("button", { name: "Add field" }));
  expect(actions.addField).toHaveBeenCalledWith({
    name: "Title",
    field_type: "text",
    max_length: 255,
    is_required: true,
    is_sortable: false,
  });
  await user.click(screen.getByRole("button", { name: "New field" }));
  expect(
    screen.getByRole("checkbox", { name: "Required field" }),
  ).not.toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: "Allow column sorting" }),
  ).toBeChecked();
});

// Test visible, translated type descriptions rather than hover-only explanations.
test.each(["en", "de"])(
  "explains every available field type in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    const user = userEvent.setup();
    renderDraftControl(<InventoryFieldCreateForm />);
    await user.click(
      screen.getByRole("button", { name: i18n.t("fields.actions.new") }),
    );
    const select = screen.getByRole("combobox", {
      name: i18n.t("fields.form.fieldType"),
    });
    for (const type of [
      "text",
      "number",
      "boolean",
      "date",
      "time",
      "datetime",
      "duration",
      "select",
      "multiselect",
    ]) {
      await user.selectOptions(select, type);
      expect(select).toHaveAccessibleDescription(
        i18n.t(`fields.typeHelp.${type}`),
      );
      expect(screen.getByText(i18n.t(`fields.typeHelp.${type}`))).toBeVisible();
    }
    expect(
      screen.getByRole("checkbox", {
        name: i18n.t("fields.settings.required"),
      }),
    ).toHaveAccessibleDescription(i18n.t("fields.settings.requiredHelp"));
  },
);
