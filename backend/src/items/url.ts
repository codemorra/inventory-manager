import { z } from "zod";

/**
 * Accept explicit HTTP or HTTPS addresses suitable for opening as web links.
 * @param value The submitted URL string.
 * @returns Whether the address has a supported scheme and a host.
 */
function isWebAddress(value: string): boolean {
  const hasControlOrSpace = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });
  if (!/^https?:\/\//iu.test(value) || hasControlOrSpace) return false;
  try {
    const parsed = new URL(value);
    return (
      ["http:", "https:"].includes(parsed.protocol) &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

// Keep optional display text separate from the actual link destination.
export const urlValueSchema = z.strictObject({
  url: z
    .string()
    .refine(isWebAddress, "A valid HTTP or HTTPS URL is required."),
  label: z.string().optional(),
});
