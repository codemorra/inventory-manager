// Keep a link destination separate from its optional display text.
export interface UrlInput {
  url: string;
  label?: string;
}

/**
 * Recognize structured link values without coercing unknown stored content.
 * @param value The form or API value to inspect.
 * @returns Whether the value contains a string address and optional string label.
 */
export function isUrlInput(value: unknown): value is UrlInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    "url" in value &&
    typeof value.url === "string" &&
    (!("label" in value) || typeof value.label === "string") &&
    Object.keys(value).every((key) => key === "url" || key === "label")
  );
}

/**
 * Match backend validation before saving or rendering a clickable destination.
 * @param value The exact address entered by the user, without implicit trimming.
 * @returns Whether the address uses HTTP(S), has a host, and contains no spaces or controls.
 */
export function isWebAddress(value: string): boolean {
  if (
    !/^https?:\/\//iu.test(value) ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x20 || code === 0x7f;
    })
  )
    return false;
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

/**
 * Select the visible label consistently for table rendering and column sorting.
 * @param value The structured link value to display.
 * @returns The optional non-blank link text, falling back to the address.
 */
export function urlDisplayText(value: UrlInput): string {
  return value.label?.trim() ? value.label : value.url;
}
