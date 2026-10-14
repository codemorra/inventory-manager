import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { DeleteConfirmationDialog } from "../../src/components/DeleteConfirmationDialog";

afterEach(cleanup);
const defaults = {
  title: "Delete inventory",
  message: 'Delete "Games"?',
  isPending: false,
  error: null,
};

// Test that merely opening a destructive dialog makes no deletion request.
test("focuses cancel and requires an explicit confirmation", async () => {
  const user = userEvent.setup();
  const confirm = vi.fn();
  render(
    <DeleteConfirmationDialog
      {...defaults}
      onClose={vi.fn()}
      onConfirm={confirm}
    />,
  );
  expect(
    screen.getByRole("dialog", { name: "Delete inventory" }),
  ).toHaveTextContent('Delete "Games"?');
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  expect(confirm).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(confirm).toHaveBeenCalledOnce();
});

// Test that all dismissal methods cancel without confirming deletion.
test("supports cancel, Escape, the close button, and backdrop dismissal", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  const confirm = vi.fn();
  render(
    <DeleteConfirmationDialog
      {...defaults}
      onClose={close}
      onConfirm={confirm}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
  expect(close).toHaveBeenCalledTimes(4);
  expect(confirm).not.toHaveBeenCalled();
});

// Test that a pending request cannot be duplicated or dismissed.
test("blocks confirmation and dismissal while deleting", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  const confirm = vi.fn();
  render(
    <DeleteConfirmationDialog
      {...defaults}
      isPending
      onClose={close}
      onConfirm={confirm}
    />,
  );
  expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Deleting…" }));
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  await user.keyboard("{Escape}");
  fireEvent.mouseDown(screen.getByRole("dialog").parentElement!);
  expect(close).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});

// Test that failures remain visible and allow another confirmation.
test("displays errors and permits retry", async () => {
  const user = userEvent.setup();
  const confirm = vi.fn();
  render(
    <DeleteConfirmationDialog
      {...defaults}
      error="Unable to delete."
      onClose={vi.fn()}
      onConfirm={confirm}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Unable to delete.");
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(confirm).toHaveBeenCalledOnce();
});

// Test that canceling returns keyboard focus to a surviving trigger.
test("restores focus after the confirmation is unmounted", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<button>Delete inventory</button>);
  const trigger = screen.getByRole("button");
  await user.click(trigger);
  rerender(
    <>
      <button>Delete inventory</button>
      <DeleteConfirmationDialog
        {...defaults}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    </>,
  );
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  rerender(<button>Delete inventory</button>);
  expect(trigger).toHaveFocus();
});
