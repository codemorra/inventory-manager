import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test } from "vitest";

import { AppShell } from "../../src/components/layout/AppShell";

afterEach(cleanup);

// Render the application shell within an in-memory router.
function renderAppShell() {
  return render(
    <MemoryRouter>
      <AppShell>
        <h1>Page content</h1>
      </AppShell>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  // Test that the shell displays its primary regions and accessibility link
  test("renders application navigation and page content", () => {
    renderAppShell();

    expect(screen.getByText("Inventory Manager")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Page content" })).toBeVisible();
    expect(
      within(screen.getByRole("complementary")).getByLabelText("Language"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Skip to content" }),
    ).toHaveAttribute("href", "#page-content");
  });

  // Test that users can open and close the navigation on small screens
  test("opens and closes the mobile navigation", async () => {
    const user = userEvent.setup();
    renderAppShell();

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const dialog = screen.getByRole("dialog", { name: "Mobile navigation" });
    expect(dialog).toBeInTheDocument();

    await user.click(
      within(dialog).getByRole("button", { name: "Close menu" }),
    );

    expect(
      screen.queryByRole("dialog", { name: "Mobile navigation" }),
    ).not.toBeInTheDocument();
  });
});
