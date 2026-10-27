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
