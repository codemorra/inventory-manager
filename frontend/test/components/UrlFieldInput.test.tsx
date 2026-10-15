import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { UrlFieldInput } from "../../src/components/UrlFieldInput";
import type { UrlInput } from "../../src/components/url";

afterEach(cleanup);

/**
 * Keep controlled URL input changes visible in component interaction tests.
 * @param disabled Whether the entire link group is locked during saving.
 * @returns A required link control with local state.
 */
function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState<UrlInput>({ url: "", label: "" });
  return (
    <UrlFieldInput
      id="website"
      label="Website"
      value={value}
      required
      disabled={disabled}
      onChange={setValue}
    />
  );
}

// Test visible validation, precise accessible labels, and independent address and display text.
test("edits an address and its optional display text with validation feedback", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  expect(screen.getByRole("group", { name: "Website" })).toBeVisible();
  const address = screen.getByLabelText("Website: Web address");
  const label = screen.getByLabelText("Website: Link text (optional)");
  expect(address).toBeRequired();
  expect(label).not.toBeRequired();
  expect(address).toHaveAttribute("type", "url");
  await user.type(label, "Documentation");
  expect(screen.getByRole("alert")).toBeVisible();
  expect(address).toHaveAttribute("aria-invalid", "true");
  await user.type(address, "https://example.com");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(label).toHaveValue("Documentation");
  await user.clear(label);
  expect(address).toHaveValue("https://example.com");
  await user.clear(address);
  await user.type(address, "javascript:alert(1)");
  expect(address).toHaveAccessibleDescription(/valid HTTP or HTTPS/);
});

// Test both controls are unavailable while the containing item mutation is pending.
test("disables the complete link group during saving", () => {
  render(<Harness disabled />);
  expect(screen.getByLabelText("Website: Web address")).toBeDisabled();
  expect(screen.getByLabelText("Website: Link text (optional)")).toBeDisabled();
});
