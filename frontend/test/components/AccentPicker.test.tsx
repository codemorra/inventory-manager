import { preferenceStore } from "../../src/preferences/store";
import { seedPreference } from "../helpers/preferences";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import { AccentPicker } from "../../src/components/AccentPicker";
import { getInitialAccent } from "../../src/appearance/accent";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.accent;
});

describe("AccentPicker", () => {
  test("orders the remaining palettes from green to graphite", () => {
    render(<AccentPicker />);
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Green", "Cyan", "Blue", "Purple", "Orange", "Graphite"]);
  });

  test("defaults to the logo green palette when no preference has been loaded", () => {
    preferenceStore.dispose();
    render(<AccentPicker />);
    expect(screen.getAllByRole("button")[0]).toHaveAccessibleName("Green");
    expect(getInitialAccent()).toBe("brand");
    expect(document.documentElement.dataset.accent).toBe("brand");
    expect(screen.getByRole("button", { name: "Green" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Rose" }),
    ).not.toBeInTheDocument();
  });

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

    expect(preferenceStore.readPreferences()?.accent).toBe("blue");
    expect(document.documentElement.dataset.accent).toBe("blue");
    for (const button of screen.getAllByRole("button", { name: "Blue" })) {
      expect(button).toHaveAttribute("aria-pressed", "true");
    }
  });

  // Test that saved colors are restored and unsupported values fall back safely.
  test("restores a stored accent", async () => {
    await seedPreference({ accent: "purple" });
    render(<AccentPicker />);
    expect(screen.getByRole("button", { name: "Purple" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(document.documentElement.dataset.accent).toBe("purple");

    expect(getInitialAccent()).toBe("purple");
  });

  test.each([
    ["brand", "Green"],
    ["cyan", "Cyan"],
    ["slate", "Graphite"],
  ] as const)("persists and restores the %s palette", async (accent, name) => {
    const user = userEvent.setup();
    await seedPreference({ accent: accent === "brand" ? "blue" : "brand" });
    const first = render(<AccentPicker />);
    await user.click(screen.getByRole("button", { name }));
    expect(document.documentElement.dataset.accent).toBe(accent);
    expect(preferenceStore.readPreferences()?.accent).toBe(accent);
    first.unmount();
    render(<AccentPicker />);
    expect(screen.getByRole("button", { name })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(getInitialAccent()).toBe(accent);
  });
});
