import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "vitest";

import { LanguageSwitch } from "../../src/components/LanguageSwitch";
import { LANGUAGE_STORAGE_KEY } from "../../src/i18n";

afterEach(cleanup);

describe("LanguageSwitch", () => {
  // Test that the language switch correctly changes the language and updates local storage.
  test("changes and stores the selected language", async () => {
    const user = userEvent.setup();
    render(<LanguageSwitch />);

    await user.selectOptions(screen.getByLabelText("Language"), "de");

    expect(screen.getByLabelText("Sprache")).toHaveValue("de");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
    expect(document.documentElement.lang).toBe("de");
  });
});
