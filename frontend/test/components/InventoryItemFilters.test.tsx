import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { InventoryItemFilters } from "../../src/components/InventoryItemFilters";
import type { ItemFilter } from "../../src/types/itemFilter";
import { filterField, filterRule } from "../helpers/itemFilters";
import { chooseOptions } from "../helpers/choices";
import i18n from "../../src/i18n";

const fields = [
  filterField("text", "Title"),
  filterField("number", "Quantity"),
  filterField("date", "Purchased"),
  filterField("time", "Time"),
  filterField("datetime", "Timestamp"),
  filterField("duration", "Elapsed"),
  filterField("multiselect", "Category"),
  filterField("checkbox", "Done"),
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Render a controlled panel and expose its Apply callback for observable draft tests.
 * @param initial The already applied conditions.
 * @returns The callback and render result for rerendering or cleanup.
 */
function renderFilters(initial: ItemFilter[] = []) {
  const apply = vi.fn();
  function Harness() {
    const [filters, setFilters] = useState(initial);
    return (
      <>
        <InventoryItemFilters
          fields={fields}
          filters={filters}
          onApply={(next) => {
            apply(next);
            setFilters(next);
          }}
        />
        <button>Outside</button>
      </>
    );
  }
  return { ...render(<Harness />), apply };
}

// Test option lists can extend outside the panel without being mistaken for outside interactions.
test("keeps the filter draft open when using portalled column and option lists", async () => {
  const user = userEvent.setup();
  const { apply } = renderFilters();
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.click(screen.getByRole("button", { name: "Add filter" }));
  const dialog = screen.getByRole("dialog");
  const column = screen.getByRole("combobox", { name: "Column" });
  await user.click(column);
  const popup = screen.getByRole("listbox");
  expect(dialog.contains(popup)).toBe(false);
  expect(popup.parentElement).toBe(document.body);
  fireEvent.scroll(popup);
  const category = screen.getByRole("option", { name: "Category" });
  fireEvent.blur(column, { relatedTarget: category });
  expect(dialog).toBeVisible();
  await user.click(category);
  await user.click(screen.getByRole("combobox", { name: "Options" }));
  await user.click(screen.getByRole("option", { name: "Adapter" }));
  fireEvent.scroll(screen.getByRole("listbox"));
  await user.click(screen.getByRole("option", { name: "Cable" }));
  expect(dialog).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(dialog).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(apply).toHaveBeenCalledWith([
    expect.objectContaining({
      fieldId: fields[6].id,
      optionIds: ["option-0", "option-1"],
    }),
  ]);
});

// Test row creation, validation, explicit Apply, marked applied count, and reopening.
test("keeps changes as drafts until Apply and validates missing values", async () => {
  const user = userEvent.setup();
  const { apply } = renderFilters();
  const trigger = screen.getByRole("button", { name: "Filters" });
  await user.click(trigger);
  expect(screen.getByRole("button", { name: "Add filter" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Add filter" }));
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid value");
  expect(apply).not.toHaveBeenCalled();
  await user.type(screen.getByRole("textbox", { name: "Value" }), "adapter");
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(apply).toHaveBeenCalledWith([
    expect.objectContaining({
      fieldId: fields[0].id,
      operator: "contains",
      value: "adapter",
    }),
  ]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(screen.getByLabelText("1 active filter")).toHaveTextContent("1");
  await user.click(trigger);
  expect(screen.getByRole("textbox", { name: "Value" })).toHaveValue("adapter");
});

// Test typed range controls, field-change cleanup, and validation of reversed limits.
test("changes controls by field type and validates both range operands", async () => {
  const user = userEvent.setup();
  const { apply } = renderFilters();
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.click(screen.getByRole("button", { name: "Add filter" }));
  await user.type(screen.getByRole("textbox", { name: "Value" }), "discard me");
  await chooseOptions(user, "Column", ["Quantity"]);
  expect(screen.getByRole("spinbutton", { name: "Value" })).toHaveValue(null);
  await chooseOptions(user, "Condition", ["is between (inclusive)"]);
  await user.type(screen.getByRole("spinbutton", { name: "Value" }), "20");
  await user.type(screen.getByRole("spinbutton", { name: "Upper value" }), "5");
  expect(screen.getByRole("spinbutton", { name: "Value" })).toHaveValue(20);
  expect(screen.getByRole("spinbutton", { name: "Upper value" })).toHaveValue(
    5,
  );
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(screen.getByRole("alert")).toHaveTextContent("upper value");
  expect(apply).not.toHaveBeenCalled();
  await user.clear(screen.getByRole("spinbutton", { name: "Upper value" }));
  await user.type(
    screen.getByRole("spinbutton", { name: "Upper value" }),
    "25",
  );
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(apply).toHaveBeenCalledWith([
    expect.objectContaining({
      operator: "between",
      value: "20",
      valueTo: "25",
    }),
  ]);
});

// Test selection uses the existing multi-choice control and no-value conditions omit operands.
test("supports multiple options and value-free checkbox or empty conditions", async () => {
  const user = userEvent.setup();
  const { apply } = renderFilters();
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.click(screen.getByRole("button", { name: "Add filter" }));
  await chooseOptions(user, "Column", ["Category"]);
  await chooseOptions(user, "Options", ["Adapter", "Cable"]);
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(apply).toHaveBeenLastCalledWith([
    expect.objectContaining({ optionIds: ["option-0", "option-1"] }),
  ]);
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await chooseOptions(user, "Column", ["Done"]);
  expect(
    screen.queryByRole("textbox", { name: "Value" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Options" }),
  ).not.toBeInTheDocument();
  await chooseOptions(user, "Condition", ["is No"]);
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(apply).toHaveBeenLastCalledWith([
    expect.objectContaining({ operator: "isFalse", value: "", optionIds: [] }),
  ]);
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await chooseOptions(user, "Condition", ["is empty"]);
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(apply).toHaveBeenLastCalledWith([
    expect.objectContaining({ operator: "isEmpty" }),
  ]);
});

// Test calendar, clock, datetime and duration controls are appropriate to the selected field.
test("renders date/time inputs and the existing duration component", async () => {
  const user = userEvent.setup();
  const { apply } = renderFilters();
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.click(screen.getByRole("button", { name: "Add filter" }));
  for (const [name, type] of [
    ["Purchased", "date"],
    ["Time", "time"],
    ["Timestamp", "datetime-local"],
  ]) {
    await chooseOptions(user, "Column", [name]);
    expect(screen.getByLabelText("Value")).toHaveAttribute("type", type);
  }
  await chooseOptions(user, "Column", ["Elapsed"]);
  await user.type(screen.getByRole("spinbutton", { name: "Hours" }), "1");
  await user.type(screen.getByRole("spinbutton", { name: "Minutes" }), "30");
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(apply).toHaveBeenCalledWith([
    expect.objectContaining({ value: "1:30:" }),
  ]);
});

// Test all dismissal paths leave the applied state untouched and nested Escape closes only the list.
test("discards drafts on Cancel, outside click and Escape", async () => {
  const user = userEvent.setup();
  const initial = filterRule(fields[0], { value: "original" });
  const { apply } = renderFilters([initial]);
  const trigger = screen.getByRole("button", { name: "Filters" });
  for (const dismiss of ["cancel", "outside", "escape"]) {
    await user.click(trigger);
    expect(screen.getByRole("textbox", { name: "Value" })).toHaveValue(
      "original",
    );
    await user.clear(screen.getByRole("textbox", { name: "Value" }));
    await user.type(screen.getByRole("textbox", { name: "Value" }), "unsaved");
    if (dismiss === "cancel")
      await user.click(screen.getByRole("button", { name: "Cancel" }));
    else if (dismiss === "outside")
      await user.click(screen.getByRole("button", { name: "Outside" }));
    else {
      await user.click(screen.getByRole("combobox", { name: "Column" }));
      await user.keyboard("{Escape}");
      expect(screen.getByRole("dialog")).toBeVisible();
      await user.keyboard("{Escape}");
      expect(trigger).toHaveFocus();
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
  }
});

// Test independent removal, repeated same-column conditions and scrolling long drafts.
test("adds repeated conditions, scrolls internally and removes rows without applying", async () => {
  const user = userEvent.setup();
  const { apply } = renderFilters();
  await user.click(screen.getByRole("button", { name: "Filters" }));
  for (let index = 0; index < 12; index++)
    await user.click(screen.getByRole("button", { name: "Add filter" }));
  const dialog = screen.getByRole("dialog");
  const row = screen.getByRole("group", { name: "Condition 12" });
  expect(
    within(row).getByRole("combobox", { name: "Column" }),
  ).toHaveTextContent("Title");
  const scroller = row.parentElement!;
  expect(scroller).toHaveClass("overflow-y-auto");
  fireEvent.scroll(scroller);
  expect(dialog).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Remove condition 2" }));
  expect(screen.getAllByRole("group")).toHaveLength(11);
  expect(screen.getByRole("button", { name: "Add filter" })).toHaveFocus();
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(apply).toHaveBeenCalledWith([]);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

// Test translated actions, stale-option validation and disabled trigger behavior.
test("supports German labels and rejects options removed while the draft is open", async () => {
  await i18n.changeLanguage("de");
  const user = userEvent.setup();
  const apply = vi.fn();
  const initial = [filterRule(fields[6], { optionIds: ["option-0"] })];
  const view = render(
    <InventoryItemFilters fields={fields} filters={initial} onApply={apply} />,
  );
  await user.click(screen.getByRole("button", { name: "Filter" }));
  view.rerender(
    <InventoryItemFilters
      fields={fields.map((field) => ({ ...field, options: [] }))}
      filters={initial}
      onApply={apply}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Anwenden" }));
  expect(screen.getByRole("alert")).toHaveTextContent("verfügbare Option");
  expect(apply).not.toHaveBeenCalled();
  view.rerender(
    <InventoryItemFilters
      fields={fields}
      filters={initial}
      onApply={apply}
      disabled
    />,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Filter" })).toBeDisabled();
});
