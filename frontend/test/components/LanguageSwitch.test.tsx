import { chooseOptions } from "../helpers/choices";
import { preferenceStore } from "../../src/preferences/store";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import { LanguageSwitch } from "../../src/components/LanguageSwitch";

afterEach(cleanup);

describe("LanguageSwitch", () => {
  // Test that the language switch correctly changes the language and updates persistent preferences.
  test("changes and stores the selected language", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitch />);

    await chooseOptions(user, "Language", ["Deutsch"]);

    expect(screen.getByLabelText("Sprache")).toHaveTextContent("Deutsch");
    expect(preferenceStore.readPreferences()?.language).toBe("de");
    expect(document.documentElement.lang).toBe("de");
  });
});
