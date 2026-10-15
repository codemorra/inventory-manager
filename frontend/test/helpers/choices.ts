import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

/**
 * Choose values through a themed dropdown, then close a multi-choice popup if necessary.
 * @param user The current user interaction session.
 * @param label The visible field name.
 * @param choices The labels to select or toggle in order.
 */
export async function chooseOptions(
  user: ReturnType<typeof userEvent.setup>,
  label: string | RegExp,
  choices: string[],
) {
  const control = screen.getByRole("combobox", { name: label });
  for (const choice of choices) {
    if (control.getAttribute("aria-expanded") !== "true")
      await user.click(control);
    await user.click(screen.getByRole("option", { name: choice }));
  }
  if (control.getAttribute("aria-expanded") === "true")
    await user.keyboard("{Escape}");
}
