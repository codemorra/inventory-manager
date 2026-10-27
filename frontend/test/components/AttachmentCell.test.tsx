import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { downloadAttachment } from "../../src/services/attachments";
import { AttachmentCell } from "../../src/components/AttachmentCell";
import { attachment } from "../helpers/attachments";

vi.mock("../../src/services/attachments", async (original) => ({
  ...(await original<object>()),
  downloadAttachment: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

// Previews fetch only generated thumbnails, retain the download target, and degrade to an icon on errors.
test("lazy-loads supported thumbnails and keeps image clicks on the download action", () => {
  const file = attachment("photo", {
    filename: "photo.jpg",
    media_type: "image/jpeg",
  });
  const { rerender, container } = render(
    <AttachmentCell ids={[file.id]} files={[file]} />,
  );
  expect(container.querySelector("img")).toBeNull();
  rerender(<AttachmentCell ids={[file.id]} files={[file]} previews />);
  const image = container.querySelector("img")!;
  expect(image).toHaveAttribute(
    "src",
    expect.stringMatching(/\/attachments\/photo\/preview$/),
  );
  expect(image).toHaveAttribute("loading", "lazy");
  expect(screen.getByRole("link", { name: "photo.jpg" })).toHaveAttribute(
    "href",
    expect.stringMatching(/\/download$/),
  );
  fireEvent.click(image);
  expect(downloadAttachment).toHaveBeenCalledExactlyOnceWith(file);
  fireEvent.error(image);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByRole("link", { name: "photo.jpg" })).toBeInTheDocument();
});

// Ordinary documents and SVG remain filename/icon tiles instead of being embedded in the application.
test("does not request previews for unsupported documents or active vector formats", () => {
  const files = [
    attachment("pdf", { filename: "file.pdf", media_type: "application/pdf" }),
    attachment("svg", { filename: "image.svg", media_type: "image/svg+xml" }),
  ];
  const { container } = render(
    <AttachmentCell
      ids={files.map((file) => file.id)}
      files={files}
      previews
    />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getAllByRole("link")).toHaveLength(2);
});

// Responsive limits are derived from available width, so narrow columns never grow to many tile rows.
test("adapts the two-row tile limit to column width while the complete list remains scrollable", async () => {
  const user = userEvent.setup();
  let resize!: ResizeObserverCallback;
  let target!: Element;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe(element: Element) {
        target = element;
      }
      disconnect() {}
    },
  );
  const files = ["one", "two", "three", "four", "five"].map((id) =>
    attachment(id),
  );
  render(
    <AttachmentCell
      ids={files.map((file) => file.id)}
      files={files}
      previews
    />,
  );
  expect(screen.getAllByRole("link")).toHaveLength(2);
  act(() =>
    resize(
      [{ target, contentRect: { width: 236 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    ),
  );
  expect(screen.getAllByRole("link")).toHaveLength(4);
  expect(screen.getByRole("button", { name: "+ 1 more" })).toBeInTheDocument();
  act(() =>
    resize(
      [{ target, contentRect: { width: 112 } } as ResizeObserverEntry],
      {} as ResizeObserver,
    ),
  );
  expect(screen.getAllByRole("link")).toHaveLength(2);
  const more = screen.getByRole("button", { name: "+ 3 more" });
  await user.click(more);
  expect(
    within(screen.getByRole("dialog", { name: "Files" })).getAllByRole("link"),
  ).toHaveLength(5);
  await user.click(screen.getByRole("button", { name: "Close dialog" }));
  expect(more).toHaveFocus();
});

// Compact display keeps every file reachable while limiting the initial cell to three entries.
test("shows download links, cursor context actions, and an accessible complete overflow list", async () => {
  const user = userEvent.setup();
  const files = ["one", "two", "three", "four", "five"].map((id) =>
    attachment(id),
  );
  render(<AttachmentCell ids={files.map((file) => file.id)} files={files} />);
  expect(screen.getAllByRole("link")).toHaveLength(3);
  const link = screen.getByRole("link", { name: "one.txt" });
  expect(link).toHaveAttribute(
    "href",
    expect.stringMatching(/\/attachments\/one\/download$/),
  );
  expect(link).toHaveAttribute("download", "one.txt");
  fireEvent.contextMenu(link, { clientX: 80, clientY: 90 });
  expect(
    screen.getByRole("menuitem", { name: "Save as…" }),
  ).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "+ 2 more" }));
  const dialog = screen.getByRole("dialog", { name: "Files" });
  expect(within(dialog).getAllByRole("link")).toHaveLength(5);
  expect(
    within(dialog).getByRole("link", { name: "five.txt" }),
  ).toHaveAttribute("href", expect.stringMatching(/\/download$/));
});

// Missing metadata stays readable without exposing opaque IDs or creating an invalid download.
test("does not render missing file identities as user-facing text or download links", () => {
  render(<AttachmentCell ids={["opaque-secret-id"]} files={[]} />);
  expect(screen.getByText("File unavailable")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByText("opaque-secret-id")).not.toBeInTheDocument();
});

// Image links use the explicit download action and suppress normal link navigation/new-tab handling.
test("downloads image attachments on left click without opening a new tab", () => {
  const file = attachment("photo", {
    filename: "photo.png",
    media_type: "image/png",
  });
  render(<AttachmentCell ids={[file.id]} files={[file]} />);
  const link = screen.getByRole("link", { name: "photo.png" });
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  fireEvent(link, click);
  expect(click.defaultPrevented).toBe(true);
  expect(link).toHaveAttribute("target", "_self");
  expect(downloadAttachment).toHaveBeenCalledExactlyOnceWith(file);
});
