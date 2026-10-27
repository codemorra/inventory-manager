import sharp from "sharp";
import { DomainError } from "../errors.js";

// Previews are transient derivatives; do not retain source images or create a second file lifecycle.
sharp.cache(false);
let pending: Promise<unknown> = Promise.resolve();

/**
 * Serialize native image jobs so a table of photos does not decode all originals concurrently.
 * @param operation The queued read/validate/render operation, including its lifecycle checks.
 * @returns That operation's result; failed jobs never poison the next preview.
 */
export function queuePreview<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.catch(() => {}).then(operation);
  pending = result.then(
    () => {},
    () => {},
  );
  return result;
}

/**
 * Accept only known raster signatures, independently of user-supplied MIME types and filenames.
 * @param header The first bytes read from an already verified regular managed file.
 * @returns Whether the source is a supported PNG, JPEG, GIF, or WebP image.
 */
export function isPreviewRaster(header: Buffer): boolean {
  return (
    header
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    header.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
    ["GIF87a", "GIF89a"].includes(header.subarray(0, 6).toString("ascii")) ||
    (header.subarray(0, 4).toString("ascii") === "RIFF" &&
      header.subarray(8, 12).toString("ascii") === "WEBP")
  );
}

/**
 * Decode a supported raster from managed disk storage and return a small metadata-free WebP.
 * @param path The verified, immutable managed file path, never a user-supplied path.
 * @returns A static, proportionally fitted preview, bounded to 320 by 240 pixels.
 */
export async function renderPreview(path: string): Promise<Buffer> {
  try {
    return await sharp(path, {
      failOn: "warning",
      limitInputPixels: 100_000_000,
      pages: 1,
    })
      .autoOrient()
      .resize(320, 240, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .timeout({ seconds: 5 })
      .toBuffer();
  } catch {
    // Invalid, unsupported or impractical previews leave the original attachment downloadable.
    throw new DomainError(
      "attachment_preview_unavailable",
      "An image preview is not available for this file.",
    );
  }
}
