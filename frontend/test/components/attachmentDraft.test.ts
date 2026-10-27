import { afterEach, expect, test, vi } from "vitest";
import { AttachmentDraft } from "../../src/components/attachmentDraft";
import {
  uploadAttachment,
  discardAttachment,
} from "../../src/services/attachments";
import {
  attachment,
  attachmentField,
  savedAttachment,
  savedItem,
} from "../helpers/attachments";

vi.mock("../../src/services/attachments", () => ({
  uploadAttachment: vi.fn(),
  discardAttachment: vi.fn().mockResolvedValue(undefined),
}));
afterEach(() => vi.clearAllMocks());

// Late responses can never append into a canceled or replacement edit session.
test("cancels a late uploaded stage without modifying a newer draft", async () => {
  let finish!: (file: ReturnType<typeof attachment>) => void;
  vi.mocked(uploadAttachment).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const draft = new AttachmentDraft();
  draft.begin([savedAttachment]);
  const append = vi.fn();
  const pending = draft.upload(
    attachmentField,
    [new File(["file"], "local.txt")],
    append,
  );
  expect(draft.getSnapshot().busy).toBe(true);
  draft.discard();
  draft.begin([savedAttachment]);
  const file = attachment("late");
  finish(file);
  await pending;
  expect(append).not.toHaveBeenCalled();
  expect(discardAttachment).toHaveBeenCalledExactlyOnceWith(file);
  expect(Object.keys(draft.getSnapshot().files)).toEqual([savedAttachment.id]);
  expect(draft.getSnapshot().busy).toBe(false);
});

// Failed saves keep the controller untouched; cancel cleans only newly staged files.
test("preserves saved ownership and cleans only newly uploaded stages on discard", async () => {
  const file = attachment("new");
  vi.mocked(uploadAttachment).mockResolvedValueOnce(file);
  const draft = new AttachmentDraft();
  draft.begin([savedAttachment]);
  await draft.upload(
    attachmentField,
    [new File(["file"], "local.txt")],
    vi.fn(),
  );
  expect(discardAttachment).not.toHaveBeenCalled();
  draft.discard();
  expect(discardAttachment).toHaveBeenCalledExactlyOnceWith(file);
  expect(discardAttachment).not.toHaveBeenCalledWith(savedAttachment);
});

// A successful atomic save retains submitted stages and discards only uploads omitted from its result.
test("retains committed files and discards unused stages after a successful save", async () => {
  const kept = attachment("kept");
  const removed = attachment("removed");
  vi.mocked(uploadAttachment)
    .mockResolvedValueOnce(kept)
    .mockResolvedValueOnce(removed);
  const draft = new AttachmentDraft();
  draft.begin();
  await draft.upload(
    attachmentField,
    [new File(["a"], "a"), new File(["b"], "b")],
    vi.fn(),
  );
  draft.finish([
    { ...savedItem, attachments: [{ ...kept, item_id: savedItem.id }] },
  ]);
  expect(discardAttachment).toHaveBeenCalledExactlyOnceWith(removed);
});

// Earlier successes remain editable and recoverable when a later selected file fails.
test("keeps earlier uploads and scopes a later failure to its originating control", async () => {
  const file = attachment("first");
  vi.mocked(uploadAttachment)
    .mockResolvedValueOnce(file)
    .mockRejectedValueOnce(new Error("Offline"));
  const draft = new AttachmentDraft();
  draft.begin();
  const append = vi.fn();
  await draft.upload(
    attachmentField,
    [new File(["a"], "a"), new File(["b"], "b")],
    append,
    "cell-1",
  );
  expect(append).toHaveBeenCalledExactlyOnceWith(file);
  expect(draft.getSnapshot()).toMatchObject({
    busy: false,
    error: true,
    target: "cell-1",
  });
  expect(draft.getSnapshot().files[file.id]).toEqual(file);
  draft.discard();
});
