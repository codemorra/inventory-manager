import { z } from "zod";

// Original names are display metadata only and may never contain path separators or header controls.
export const attachmentMetadataSchema = z.strictObject({
  filename: z
    .string()
    .min(1)
    .refine(
      (name) =>
        Array.from(name).length <= 255 &&
        name.trim().length > 0 &&
        name !== "." &&
        name !== ".." &&
        !/[/\\]/u.test(name) &&
        Array.from(name).every(
          (letter) =>
            letter.codePointAt(0)! >= 32 && letter.codePointAt(0)! !== 127,
        ),
      "Invalid filename.",
    ),
  media_type: z
    .string()
    .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/)
    .default("application/octet-stream"),
});
