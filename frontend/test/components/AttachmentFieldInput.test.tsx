import { preferenceStore } from "../../src/preferences/store";
import { useState } from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AttachmentDraft } from "../../src/components/attachmentDraft";
import { AttachmentFieldInput } from "../../src/components/AttachmentFieldInput";
import { GeneralSettings } from "../../src/components/GeneralSettings";
import {
  uploadAttachment,
  discardAttachment,
} from "../../src/services/attachments";
import { attachment, attachmentField } from "../helpers/attachments";
import { largeAttachmentWarningBytes } from "../../src/hooks/useAttachmentWarnings";

vi.mock("../../src/services/attachments", async (original) => ({
  ...(await original<object>()),
  uploadAttachment: vi.fn(),
  discardAttachment: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(uploadAttachment).mockResolvedValue(attachment("uploaded"));
  vi.mocked(discardAttachment).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/**
 * Select a synthetic file with an exact advisory size without allocating a 100-MiB buffer.
 * @param size The desired metadata size in bytes.
 * @returns A browser File suitable for warning-boundary tests.
 */
function file(size: number) {
  const value = new File(["small test payload"], "large.txt", {
    type: "text/plain",
  });
  Object.defineProperty(value, "size", { value: size });
  return value;
}

/** Render a live field value with optional access to the actual general settings controls. */
function show() {
  const draft = new AttachmentDraft();
  draft.begin();
  function Harness() {
    const [ids, setIds] = useState<string[]>([]);
    const [settings, setSettings] = useState(false);
    return (
      <>
        <AttachmentFieldInput
          id="file-input"
          field={attachmentField}
          value={ids}
          onChange={setIds}
          disabled={false}
          draft={draft}
        />
        <button type="button" onClick={() => setSettings(true)}>
          Open settings
        </button>
        {settings && (
          <>
            <GeneralSettings />
            <button type="button" onClick={() => setSettings(false)}>
              Close settings
            </button>
          </>
        )}
      </>
    );
  }
  render(<Harness />);
  return draft;
}

// The warning threshold is advisory: smaller files upload immediately, the exact boundary asks first.
test("warns at 100 MiB and permits proceeding without imposing a limit", async () => {
  const user = userEvent.setup();
  show();
  await user.upload(
    screen.getByLabelText("Files"),
    file(largeAttachmentWarningBytes),
  );
  const dialog = screen.getByRole("dialog", { name: "Add large files?" });
  expect(uploadAttachment).not.toHaveBeenCalled();
  expect(within(dialog).getByText(/additional disk space/)).toBeInTheDocument();
  expect(
    within(dialog).queryByText(/without a size limit/),
  ).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Add files" }));
  await waitFor(() => expect(uploadAttachment).toHaveBeenCalledOnce());
  expect(
    await screen.findByRole("link", { name: "uploaded.txt" }),
  ).toBeInTheDocument();
});

// Remembered dismissal synchronizes immediately with Settings, which can restore future warnings.
test("remembers warning dismissal and restores warnings from Settings", async () => {
  const user = userEvent.setup();
  show();
  await user.upload(
    screen.getByLabelText("Files"),
    file(largeAttachmentWarningBytes + 1),
  );
  await user.click(screen.getByLabelText("Do not show this warning again"));
  await user.click(screen.getByRole("button", { name: "Add files" }));
  await waitFor(() => expect(uploadAttachment).toHaveBeenCalledOnce());
  expect(preferenceStore.readPreferences()?.attachmentWarnings).toBe("hide");
  vi.mocked(uploadAttachment).mockResolvedValueOnce(attachment("second"));
  await user.upload(
    screen.getByLabelText("Files"),
    file(largeAttachmentWarningBytes * 5),
  );
  await waitFor(() => expect(uploadAttachment).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open settings" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Warn before adding large files" }),
  );
  expect(preferenceStore.readPreferences()?.attachmentWarnings).toBe("show");
  await user.click(screen.getByRole("button", { name: "Close settings" }));
  await user.upload(
    screen.getByLabelText("Files"),
    file(largeAttachmentWarningBytes),
  );
  expect(
    screen.getByRole("dialog", { name: "Add large files?" }),
  ).toBeInTheDocument();
  expect(uploadAttachment).toHaveBeenCalledTimes(2);
});

// Canceling the advisory confirmation does not upload anything or change persistent preferences.
test("cancels a large-file batch before uploading or remembering a preference", async () => {
  const user = userEvent.setup();
  show();
  await user.upload(screen.getByLabelText("Files"), [
    file(largeAttachmentWarningBytes),
    new File(["small"], "small.txt"),
  ]);
  await user.click(screen.getByLabelText("Do not show this warning again"));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(uploadAttachment).not.toHaveBeenCalled();
  expect(preferenceStore.readPreferences()?.attachmentWarnings).toBe("show");
});

// Just below the boundary is not a warning case, and removing a staged name changes only the local value.
test("uploads below the threshold and removes a file locally until the parent draft is finished", async () => {
  const user = userEvent.setup();
  show();
  await user.upload(
    screen.getByLabelText("Files"),
    file(largeAttachmentWarningBytes - 1),
  );
  await screen.findByRole("link", { name: "uploaded.txt" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remove uploaded.txt" }));
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(discardAttachment).not.toHaveBeenCalled();
});
