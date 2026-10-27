import { afterEach, expect, test, vi } from "vitest";
import {
  uploadAttachment,
  discardAttachment,
  attachmentDownloadUrl,
  downloadAttachment,
} from "../../src/services/attachments";
import { attachment } from "../helpers/attachments";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The original File is the fetch body, avoiding JSON/base64 or whole-file ArrayBuffer copies.
test("uploads binary Files with encoded Unicode names and declared media type", async () => {
  const metadata = attachment();
  const fetch = vi
    .fn()
    .mockResolvedValue({ ok: true, status: 201, json: async () => metadata });
  vi.stubGlobal("fetch", fetch);
  const file = new File(["data"], "Prüfung.pdf", { type: "application/pdf" });
  await expect(uploadAttachment("inventory", "files", file)).resolves.toEqual(
    metadata,
  );
  expect(fetch.mock.calls[0][0]).toMatch(
    /\/inventories\/inventory\/fields\/files\/attachments$/,
  );
  expect(fetch.mock.calls[0][1]).toMatchObject({
    method: "POST",
    body: file,
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      "X-File-Type": "application/pdf",
    },
  });
});

// Explicit download actions must never inherit a new-tab target or buffer file contents.
test("starts a native download in the current tab and removes its temporary control", () => {
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const file = attachment("image", {
    filename: "image.png",
    media_type: "image/png",
  });
  downloadAttachment(file);
  const target = click.mock.contexts[0] as HTMLAnchorElement;
  expect(click).toHaveBeenCalledOnce();
  expect(target?.target).toBe("_self");
  expect(target?.download).toBe("image.png");
  expect(target?.href).toBe(attachmentDownloadUrl(file));
  expect(target?.isConnected).toBe(false);
});

// Download links stream directly from the backend, and cancellation uses the original field scope.
test("builds download-only links and cancels stages without requesting system application opening", async () => {
  const metadata = attachment("file/id", {
    inventory_id: "inventory/id",
    field_id: "field/id",
  });
  expect(attachmentDownloadUrl(metadata)).toMatch(
    /\/inventories\/inventory%2Fid\/fields\/field%2Fid\/attachments\/file%2Fid\/download$/,
  );
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal("fetch", fetch);
  await discardAttachment(metadata);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
});
