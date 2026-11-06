import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ImportFileInput } from "../../src/components/ImportFileInput";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// The visible themed button owns keyboard focus and invokes the hidden native picker, retaining ordinary file selection.
test("opens the picker through its visible button and forwards the selected file", async () => {
  const user = userEvent.setup();
  const selected = vi.fn();
  render(
    <ImportFileInput
      label="CSV file (.csv)"
      accept=".csv"
      disabled={false}
      onSelect={selected}
    />,
  );
  const input = screen.getByLabelText<HTMLInputElement>("CSV file (.csv)");
  const browse = screen.getByRole("button", { name: "Choose file…" });
  expect(browse).toHaveFocus();
  const click = vi.spyOn(input, "click").mockImplementation(() => {});
  await user.click(browse);
  expect(click).toHaveBeenCalledOnce();
  click.mockRestore();
  const file = new File(["Code\n00123"], "parts.csv");
  await user.upload(input, file);
  expect(selected).toHaveBeenCalledExactlyOnceWith(file);
  expect(input.value).toBe("");
});

// Locked publication must block both the visible button and its underlying file control.
test("prevents replacing the file when the picker is disabled", async () => {
  const user = userEvent.setup();
  const selected = vi.fn();
  render(
    <ImportFileInput
      label="Markdown file (.md)"
      accept=".md"
      disabled
      onSelect={selected}
    />,
  );
  const input = screen.getByLabelText<HTMLInputElement>("Markdown file (.md)");
  const click = vi.spyOn(input, "click").mockImplementation(() => {});
  await user.click(screen.getByRole("button", { name: "Choose file…" }));
  expect(input).toBeDisabled();
  expect(click).not.toHaveBeenCalled();
  expect(selected).not.toHaveBeenCalled();
});
