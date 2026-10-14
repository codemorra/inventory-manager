import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { GroupCreateDialog } from "../../src/components/GroupCreateDialog";
import { createInventoryGroup } from "../../src/services/inventoryGroups";

vi.mock("../../src/services/inventoryGroups", () => ({
  createInventoryGroup: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/**
 * Render the creation dialog with an isolated query cache.
 * @param onClose Callback invoked after creation or cancellation.
 */
function renderDialog(onClose: () => void) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GroupCreateDialog onClose={onClose} />
    </QueryClientProvider>,
  );
}

// Test that the small dialog creates a named group and closes after success.
test("creates a group with a trimmed name and closes", async () => {
  vi.mocked(createInventoryGroup).mockResolvedValue({
    id: "group",
    name: "Leisure",
    created_at: "",
    updated_at: "",
  });
  const user = userEvent.setup();
  const close = vi.fn();
  renderDialog(close);
  await user.type(screen.getByLabelText("Group name"), " Leisure ");
  await user.click(screen.getByRole("button", { name: "Create group" }));
  await waitFor(() =>
    expect(createInventoryGroup).toHaveBeenCalledWith("Leisure"),
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

// Test that a failed request retains the form and displays an error.
test("keeps the dialog open when creation fails", async () => {
  vi.mocked(createInventoryGroup).mockRejectedValue(
    new Error("Synthetic failure"),
  );
  const user = userEvent.setup();
  const close = vi.fn();
  renderDialog(close);
  await user.type(screen.getByLabelText("Group name"), "Leisure");
  await user.click(screen.getByRole("button", { name: "Create group" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.getByLabelText("Group name")).toHaveValue("Leisure");
  expect(close).not.toHaveBeenCalled();
});

// Test that dismissal does not create a group.
test("cancels without submitting", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  renderDialog(close);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
  expect(createInventoryGroup).not.toHaveBeenCalled();
});
