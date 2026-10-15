import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { InventoryFieldCreateForm } from "../../src/components/InventoryFieldCreateForm";
import { renderDraftControl, selectFieldType } from "../helpers/inventoryDraft";
import i18n from "../../src/i18n";
afterEach(cleanup);

// Test compact sizing and frontend limits matching the backend's accepted text configuration.
test.each(["", "0", "-1", "+1", "1.5", "1,5", "1e2", "abc", " 10", "001"])(
  "rejects an invalid text limit: %s",
  async (limit) => {
    const user = userEvent.setup();
    const { actions } = renderDraftControl(<InventoryFieldCreateForm />);
    await user.click(screen.getByRole("button", { name: "New field" }));
    await user.type(screen.getByLabelText("Field name"), "Notes");
    const input = screen.getByLabelText("Maximum length");
    expect(input.parentElement).toHaveClass("w-24", "max-w-full");
    expect(input).toHaveAttribute("role", "spinbutton");
    expect(input).toHaveAttribute("aria-valuemin", "1");
    expect(input).toHaveAttribute("aria-valuemax", "1000");
    expect(input).toHaveAttribute("inputmode", "numeric");
    expect(input).toHaveAttribute("maxlength", "4");
    expect(input).toHaveAccessibleDescription("1 to 1,000 characters.");
    await user.clear(input);
    if (limit) await user.paste(limit);
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add field" })).toBeDisabled();
    fireEvent.submit(input.closest("form")!);
    expect(actions.addField).not.toHaveBeenCalled();
  },
);

// Test both accepted boundaries rather than relying only on the native input attributes.
test.each([1, 1000])("accepts the text limit boundary %i", async (limit) => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(<InventoryFieldCreateForm />);
  await user.click(screen.getByRole("button", { name: "New field" }));
  await user.type(screen.getByLabelText("Field name"), "Notes");
  await user.clear(screen.getByLabelText("Maximum length"));
  await user.type(screen.getByLabelText("Maximum length"), String(limit));
  await user.click(screen.getByRole("button", { name: "Add field" }));
  expect(actions.addField).toHaveBeenCalledWith(
    expect.objectContaining({ max_length: limit }),
  );
});

// Test immediate rejection for typing, paste, and programmatic change events.
test("prevents entering a text limit above 1000", async () => {
  const user = userEvent.setup();
  const { actions } = renderDraftControl(<InventoryFieldCreateForm />);
  await user.click(screen.getByRole("button", { name: "New field" }));
  await user.type(screen.getByLabelText("Field name"), "Notes");
  const input = screen.getByLabelText("Maximum length");
  await user.clear(input);
  await user.type(input, "1000");
  await user.type(input, "1");
  expect(input).toHaveValue("1000");
  fireEvent.change(input, { target: { value: "1001" } });
  expect(input).toHaveValue("1000");
  await user.clear(input);
  await user.paste("1001");
  expect(input).toHaveValue("");
  expect(screen.getByRole("button", { name: "Add field" })).toBeDisabled();
  await user.paste("1000");
  expect(input).toHaveValue("1000");
  await user.click(screen.getByRole("button", { name: "Add field" }));
  expect(actions.addField).toHaveBeenCalledWith(
    expect.objectContaining({ max_length: 1000 }),
  );
});

// Test character filtering without interfering with normal selection, deletion, and replacement.
test("blocks non-digit typing while allowing text editing and valid pasted limits", async () => {
  const user = userEvent.setup();
  renderDraftControl(<InventoryFieldCreateForm />);
  await user.click(screen.getByRole("button", { name: "New field" }));
  const input = screen.getByLabelText("Maximum length");
  await user.type(input, "abc.eE+-, ");
  expect(input).toHaveValue("255");
  await user.keyboard("{Control>}a{/Control}");
  await user.paste("500");
  expect(input).toHaveValue("500");
  await user.keyboard("{Backspace}");
  expect(input).toHaveValue("50");
  await user.clear(input);
  await user.type(input, "1");
  expect(input).toHaveValue("1");
});

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
    await selectFieldType(user, type);
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
    await selectFieldType(user, type);
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
  await selectFieldType(user, "select");
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
      await selectFieldType(user, type);
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
