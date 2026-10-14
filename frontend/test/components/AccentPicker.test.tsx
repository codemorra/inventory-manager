import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import { AccentPicker } from "../../src/components/AccentPicker";
import {
  ACCENT_STORAGE_KEY,
  getInitialAccent,
} from "../../src/appearance/accent";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.accent;
});

describe("AccentPicker", () => {
  // Test that accent changes are persisted and shared across navigation controls.
  test("applies and synchronizes the selected accent", async () => {
    const user = userEvent.setup();
    render(
      <>
        <AccentPicker />
        <AccentPicker />
      </>,
    );

    await user.click(screen.getAllByRole("button", { name: "Blue" })[0]!);

    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("blue");
    expect(document.documentElement.dataset.accent).toBe("blue");
    for (const button of screen.getAllByRole("button", { name: "Blue" })) {
      expect(button).toHaveAttribute("aria-pressed", "true");
    }
  });

  // Test that saved colors are restored and unsupported values fall back safely.
  test("restores a stored accent and rejects unsupported preferences", () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, "purple");
    render(<AccentPicker />);
    expect(screen.getByRole("button", { name: "Purple" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.documentElement.dataset.accent).toBe("purple");

    localStorage.setItem(ACCENT_STORAGE_KEY, "invalid");
    expect(getInitialAccent()).toBe("teal");
  });
});
