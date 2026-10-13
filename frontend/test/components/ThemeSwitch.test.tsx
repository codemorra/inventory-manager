import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import { ThemeSwitch } from "../../src/components/ThemeSwitch";
import { THEME_STORAGE_KEY } from "../../src/appearance/theme";

afterEach(() => {
  cleanup();
  document.documentElement.dataset.theme = "light";
});

describe("ThemeSwitch", () => {
  // Test that the theme switch applies and stores the selected appearance
  test("changes and stores the selected theme", async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);

    await user.selectOptions(screen.getByLabelText("Appearance"), "dark");

    expect(screen.getByLabelText("Appearance")).toHaveValue("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
