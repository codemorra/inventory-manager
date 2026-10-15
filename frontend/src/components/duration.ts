// Keep duration editing separate from its persisted integer-second representation.
export interface DurationInput {
  hours: string;
  minutes: string;
  seconds: string;
}

export const maximumDurationHours = Math.floor(Number.MAX_SAFE_INTEGER / 3600);

// Initialize an unset duration without silently storing a zero-length interval.
export function emptyDuration(): DurationInput {
  return { hours: "", minutes: "", seconds: "" };
}

/**
 * Identify a duration form value before reading its component strings.
 * @param value The untrusted form value.
 * @returns Whether the value contains hours, minutes, and seconds as strings.
 */
export function isDurationInput(value: unknown): value is DurationInput {
  return (
    typeof value === "object" &&
    value !== null &&
    "hours" in value &&
    typeof value.hours === "string" &&
    "minutes" in value &&
    typeof value.minutes === "string" &&
    "seconds" in value &&
    typeof value.seconds === "string"
  );
}

/**
 * Combine duration components without accepting fractions, overflow, or implicit zero values.
 * @param value The hours, minutes, and seconds being edited.
 * @returns Safe integer seconds, including explicit zero, or null for unset/invalid input.
 */
export function durationSeconds(value: DurationInput): number | null {
  const parts = [value.hours, value.minutes, value.seconds];
  if (
    parts.every((part) => part === "") ||
    parts.some((part) => part !== "" && !/^(0|[1-9][0-9]*)$/.test(part))
  )
    return null;
  const [hours, minutes, seconds] = parts.map(Number);
  if (hours > maximumDurationHours || minutes > 59 || seconds > 59) return null;
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

/**
 * Split stored seconds without wrapping elapsed hours at midnight.
 * @param value The stored duration in seconds.
 * @returns Its editable components, or an empty duration for an absent/invalid value.
 */
export function durationFromSeconds(value: unknown): DurationInput {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    return emptyDuration();
  return {
    hours: String(Math.floor(value / 3600)),
    minutes: String(Math.floor((value % 3600) / 60)),
    seconds: String(value % 60),
  };
}

/**
 * Display elapsed time using compact, language-independent unit symbols.
 * @param value The stored integer-second duration.
 * @param locale The language used to format the hour count.
 * @returns A readable duration, preserving zero and hours beyond a day.
 */
export function formatDuration(value: number, locale: string): string {
  const parts = durationFromSeconds(value);
  if (parts.hours === "") return String(value);
  const hours = Number(parts.hours);
  const minutes = Number(parts.minutes);
  const seconds = Number(parts.seconds);
  return [
    hours ? `${new Intl.NumberFormat(locale).format(hours)} h` : "",
    minutes ? `${minutes} min` : "",
    seconds || (!hours && !minutes) ? `${seconds} s` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
