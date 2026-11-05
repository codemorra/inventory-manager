import {
  cleanup,
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

test("renders only filenames and icons without requesting images", () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const file = attachment("photo", {
    filename: "photo.png",
    media_type: "image/png",
  });
  const { container } = render(
    <AttachmentCell ids={[file.id]} files={[file]} />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
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
  await user.click(link);
  expect(downloadAttachment).toHaveBeenCalledExactlyOnceWith(files[0]);
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

test("opens only the clicked image, handles decoding errors, and retains download and focus", async () => {
  const user = userEvent.setup();
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ "Content-Type": "image/png" }),
    blob: async () => new Blob(["image"]),
  });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:preview"),
    revokeObjectURL: vi.fn(),
  });
  const file = attachment("photo", {
    filename: "photo.png",
    media_type: "image/png",
  });
  render(<AttachmentCell ids={[file.id]} files={[file]} />);
  const link = screen.getByRole("link", { name: file.filename });
  await user.click(link);
  const dialog = screen.getByRole("dialog", { name: file.filename });
  const image = await within(dialog).findByRole("img", { name: file.filename });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toMatch(/photo\/preview$/);
  expect(screen.getByRole("status")).toHaveTextContent("Loading image");
  fireEvent.error(image);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Image preview unavailable",
  );
  expect(within(dialog).queryByRole("button", { name: "Save as…" })).toBeNull();
  fireEvent.contextMenu(screen.getByRole("alert"), {
    clientX: 80,
    clientY: 90,
  });
  await user.click(screen.getByRole("menuitem", { name: "Save as…" }));
  expect(downloadAttachment).toHaveBeenCalledExactlyOnceWith(file);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(link).toHaveFocus();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  await user.click(link);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("aborts pending requests on dismissal and ignores late results", async () => {
  const user = userEvent.setup();
  let finish!: (response: unknown) => void;
  const fetch = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
  const file = attachment("photo", { filename: "photo.jpg" });
  const { unmount } = render(<AttachmentCell ids={[file.id]} files={[file]} />);
  await user.click(screen.getByRole("link"));
  const signal = (fetch.mock.calls as unknown as [string, RequestInit][])[0][1]
    .signal!;
  unmount();
  expect(signal.aborted).toBe(true);
  finish({
    ok: true,
    headers: new Headers({ "Content-Type": "image/jpeg" }),
    blob: async () => new Blob(),
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

test("shows a decoded image and confines keyboard focus to the modal", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "Content-Type": "image/png" }),
      blob: async () => new Blob(),
    }),
  );
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:ready"),
    revokeObjectURL: vi.fn(),
  });
  const file = attachment("photo", { filename: "photo.png" });
  const { rerender } = render(
    <AttachmentCell ids={[file.id]} files={[file]} />,
  );
  await user.click(screen.getByRole("link"));
  const image = await screen.findByRole("img");
  Object.defineProperties(image, {
    naturalWidth: { value: 32 },
    naturalHeight: { value: 16 },
  });
  fireEvent.load(image);
  expect(screen.queryByRole("status")).toBeNull();
  expect(image).not.toHaveClass("invisible");
  const close = screen.getByRole("button", { name: "Close dialog" });
  expect(close).toHaveFocus();
  await user.tab({ shift: true });
  expect(image.parentElement).toHaveFocus();
  await user.keyboard("{Shift>}{F10}{/Shift}");
  expect(screen.getByRole("menuitem", { name: "Save as…" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(
    screen.getByRole("dialog", { name: file.filename }),
  ).toBeInTheDocument();
  expect(image.parentElement).toHaveFocus();
  await user.tab();
  expect(close).toHaveFocus();
  rerender(<AttachmentCell ids={[]} files={[]} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:ready");
});

test("shows a request error and aborts the previous image when another is selected", async () => {
  const user = userEvent.setup();
  const fetch = vi.fn().mockResolvedValue({ ok: false });
  vi.stubGlobal("fetch", fetch);
  const files = [
    attachment("first", { filename: "first.png" }),
    attachment("second", { filename: "second.png" }),
  ];
  render(<AttachmentCell ids={files.map((file) => file.id)} files={files} />);
  await user.click(screen.getByRole("link", { name: "first.png" }));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  const signal = fetch.mock.calls[0][1].signal as AbortSignal;
  fireEvent.click(screen.getByRole("link", { name: "second.png" }));
  expect(signal.aborted).toBe(true);
  expect(
    screen.getByRole("dialog", { name: "second.png" }),
  ).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
});
