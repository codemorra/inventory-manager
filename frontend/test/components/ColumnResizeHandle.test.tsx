import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ColumnResizeHandle } from "../../src/components/ColumnResizeHandle";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Test pointer resizing starts at the visible edge rather than a smaller automatic base.
test("previews the displayed width plus pointer movement and commits only on release", () => {
  const preview = vi.fn();
  const commit = vi.fn();
  render(
    <ColumnResizeHandle
      fieldName="Title"
      width={240}
      displayWidth={600}
      onPreview={preview}
      onCommit={commit}
      onReset={vi.fn()}
    />,
  );
  const handle = screen.getByRole("separator", { name: "Resize Title" });
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 160 });
  expect(preview).toHaveBeenLastCalledWith(660);
  expect(commit).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 160 });
  expect(commit).toHaveBeenCalledExactlyOnceWith(660);
  expect(preview).toHaveBeenLastCalledWith(null);
});

// Test cancellation does not accidentally store a drag's unsaved width.
test("discards previews on pointer cancellation and Escape", () => {
  const preview = vi.fn();
  const commit = vi.fn();
  render(
    <ColumnResizeHandle
      fieldName="Title"
      width={240}
      onPreview={preview}
      onCommit={commit}
      onReset={vi.fn()}
    />,
  );
  const handle = screen.getByRole("separator", { name: "Resize Title" });
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 160 });
  fireEvent.pointerCancel(handle, { pointerId: 1 });
  expect(preview).toHaveBeenLastCalledWith(null);
  fireEvent.pointerDown(handle, { pointerId: 2, button: 0, clientX: 100 });
  fireEvent.pointerMove(handle, { pointerId: 2, clientX: 200 });
  fireEvent.keyDown(handle, { key: "Escape" });
  fireEvent.pointerUp(handle, { pointerId: 2 });
  expect(commit).not.toHaveBeenCalled();
  expect(preview).toHaveBeenLastCalledWith(null);
});

// Test keyboard users can resize in different increments and restore defaults.
test("resizes with the keyboard and resets with a double click", async () => {
  const user = userEvent.setup();
  const commit = vi.fn();
  const reset = vi.fn();
  render(
    <ColumnResizeHandle
      fieldName="Title"
      width={240}
      onPreview={vi.fn()}
      onCommit={commit}
      onReset={reset}
    />,
  );
  const handle = screen.getByRole("separator", { name: "Resize Title" });
  handle.focus();
  await user.keyboard("{ArrowRight}");
  expect(commit).toHaveBeenLastCalledWith(256);
  await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
  expect(commit).toHaveBeenLastCalledWith(192);
  await user.keyboard("{Home}");
  expect(commit).toHaveBeenLastCalledWith(48);
  await user.keyboard("{End}");
  expect(commit).toHaveBeenLastCalledWith(1200);
  await user.dblClick(handle);
  expect(reset).toHaveBeenCalledOnce();
});
