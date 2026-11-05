import { DomainError } from "../errors.js";

// Bound network/blob storage and decoded canvas size separately. Header inspection is not decoding.
export const maxPreviewBytes = 25 * 1024 * 1024;
export const previewHeaderBytes = 256 * 1024;
const maxPreviewPixels = 40_000_000;

export function previewUnavailable(): never {
  throw new DomainError(
    "attachment_preview_unavailable",
    "An image preview is not available for this file.",
  );
}

/** Inspect bounded raster headers, never trusting names or uploaded MIME declarations. */
export function inspectPreview(header: Buffer): string {
  let type = "";
  let width = 0;
  let height = 0;
  if (
    header.length >= 33 &&
    header
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    header.readUInt32BE(8) === 13 &&
    header.toString("ascii", 12, 16) === "IHDR"
  ) {
    type = "image/png";
    width = header.readUInt32BE(16);
    height = header.readUInt32BE(20);
  } else if (
    header.length >= 13 &&
    ["GIF87a", "GIF89a"].includes(header.toString("ascii", 0, 6))
  ) {
    type = "image/gif";
    width = header.readUInt16LE(6);
    height = header.readUInt16LE(8);
  } else if (
    header.length >= 30 &&
    header.toString("ascii", 0, 4) === "RIFF" &&
    header.toString("ascii", 8, 12) === "WEBP"
  ) {
    type = "image/webp";
    const chunk = header.toString("ascii", 12, 16);
    if (chunk === "VP8X" && header.readUInt32LE(16) === 10) {
      width = 1 + header.readUIntLE(24, 3);
      height = 1 + header.readUIntLE(27, 3);
    } else if (chunk === "VP8L" && header[20] === 0x2f) {
      const bits = header.readUInt32LE(21);
      width = 1 + (bits & 0x3fff);
      height = 1 + ((bits >>> 14) & 0x3fff);
    } else if (
      chunk === "VP8 " &&
      header.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))
    ) {
      width = header.readUInt16LE(26) & 0x3fff;
      height = header.readUInt16LE(28) & 0x3fff;
    }
  } else if (
    header.length >= 4 &&
    header[0] === 0xff &&
    header[1] === 0xd8 &&
    header[2] === 0xff
  ) {
    type = "image/jpeg";
    let offset = 2;
    while (offset + 4 <= header.length) {
      if (header[offset++] !== 0xff) break;
      while (header[offset] === 0xff) offset++;
      const marker = header[offset++];
      if (marker === undefined || marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > header.length) break;
      const length = header.readUInt16BE(offset);
      if (length < 2 || offset + length > header.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker) &&
        length >= 8
      ) {
        height = header.readUInt16BE(offset + 3);
        width = header.readUInt16BE(offset + 5);
        break;
      }
      offset += length;
    }
  }
  if (
    !width ||
    !height ||
    width * height > maxPreviewPixels ||
    width > 32768 ||
    height > 32768
  )
    previewUnavailable();
  return type;
}
