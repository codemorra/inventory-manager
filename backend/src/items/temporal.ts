// Temporal value validation utilities for inventory items.
export class InvalidTemporalValueError extends Error {
  constructor(fieldType: string) {
    super(`Invalid ${fieldType} format.`);
    this.name = "InvalidTemporalValueError";
  }
}

// Determine if a given year is a leap year.
const leapYear = (year: number) =>
  year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

// Parse and validate date strings in various formats (calendar, week).
function parsedDate(value: string): Date | undefined {
  const calendar = /^(\d{4})(-?)(\d{2})\2(\d{2})$/u.exec(value);
  if (calendar && calendar[0] === value) {
    const year = Number(calendar[1]);
    const month = Number(calendar[3]);
    const day = Number(calendar[4]);
    const days = [
      31,
      leapYear(year) ? 29 : 28,
      31,
      30,
      31,
      30,
      31,
      31,
      30,
      31,
      30,
      31,
    ];
    const valid =
      year >= 1 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      day <= days[month - 1]!;
    if (!valid) return undefined;
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return date;
  }
  const weekDate = /^(\d{4})(-?)W(\d{2})(?:\2([1-7]))?$/u.exec(value);
  if (!weekDate || weekDate[0] !== value) return undefined;
  const year = Number(weekDate[1]);
  const week = Number(weekDate[3]);
  const day = Number(weekDate[4] ?? 1);
  if (year < 1 || week < 1 || week > 53) return undefined;
  const january = new Date(0);
  january.setUTCFullYear(year, 0, 1);
  const firstWeekday = january.getUTCDay() || 7;
  if (
    week === 53 &&
    firstWeekday !== 4 &&
    !(firstWeekday === 3 && leapYear(year))
  )
    return undefined;
  january.setUTCDate(4);
  january.setUTCDate(
    4 - ((january.getUTCDay() || 7) - 1) + (week - 1) * 7 + day - 1,
  );
  return january.getUTCFullYear() >= 1 && january.getUTCFullYear() <= 9999
    ? january
    : undefined;
}

/**
 * Parses clock parts from a time string.
 * @param value The time string to parse.
 * @returns An array of numbers representing hours, minutes, seconds, and fractional seconds, or undefined if invalid.
 */
function clockParts(value: string): number[] | undefined {
  const match = /^(\d{2})(?:(:?)(\d{2})(?:\2(\d{2})(?:[.,](\d+))?)?)?$/u.exec(
    value,
  );
  if (!match || match[0] !== value) return undefined;
  return [
    Number(match[1]),
    Number(match[3] ?? 0),
    Number(match[4] ?? 0),
    Number(`0.${match[5]?.slice(0, 6) ?? "0"}`),
  ];
}

/**
 * Validates a time string according to the rules for hours, minutes, seconds, and optional timezone.
 * @param value The time string to validate.
 * @returns True if the time string is valid, false otherwise.
 */
function validTime(value: string): boolean {
  const timezoneAt = value.search(/[+\-Z]/u);
  const clock = clockParts(timezoneAt < 0 ? value : value.slice(0, timezoneAt));
  if (!clock || clock[0]! > 24 || clock[1]! > 59 || clock[2]! > 59)
    return false;
  if (clock[0] === 24 && clock.slice(1).some((component) => component !== 0))
    return false;
  if (timezoneAt < 0) return true;
  const timezone = value.slice(timezoneAt);
  if (timezone === "Z") return true;
  if (timezone[0] !== "+" && timezone[0] !== "-") return false;
  const offset = clockParts(timezone.slice(1));
  // The reference normalizes offset components, permitting e.g. +00:90 but not a total of 24h.
  return (
    !!offset &&
    offset[0]! * 3600 + offset[1]! * 60 + offset[2]! + offset[3]! < 86400
  );
}

/**
 * Determines the position of the date/time separator in a temporal string.
 * @param value An array of characters representing the temporal string.
 * @returns The index of the separator.
 */
function dateSeparator(value: string[]): number {
  if (value[4] === "-") {
    if (value[5] !== "W") return 10;
    if (value[8] !== "-") return 8;
    return value[10] !== undefined && /^[0-9]$/u.test(value[10]) ? 8 : 10;
  }
  if (value[4] !== "W") return 8;
  let end = 7;
  while (value[end] !== undefined && /^[0-9]$/u.test(value[end]!)) end++;
  return end < 9 ? end : end % 2 === 0 ? 7 : 8;
}

/**
 * Validates a temporal value (date, time, or datetime) according to the specified field type.
 * @param fieldType The type of temporal field ("date", "time", or "datetime").
 * @param value The temporal value to validate.
 * @throws {InvalidTemporalValueError} If the value is not valid for the specified field type.
 */
export function validateTemporalValue(
  fieldType: "date" | "time" | "datetime",
  value: string,
): void {
  let valid: boolean;
  if (fieldType === "date") valid = parsedDate(value) !== undefined;
  else if (fieldType === "time")
    valid = validTime(value.startsWith("T") ? value.slice(1) : value);
  else if (parsedDate(value)) valid = true;
  else {
    const characters = Array.from(value);
    const separator = dateSeparator(characters);
    const date = parsedDate(characters.slice(0, separator).join(""));
    const time = characters.slice(separator + 1).join("");
    valid = date !== undefined && validTime(time);
    if (valid && time.startsWith("24")) {
      date!.setUTCDate(date!.getUTCDate() + 1);
      valid = date!.getUTCFullYear() <= 9999;
    }
  }
  if (!valid) throw new InvalidTemporalValueError(fieldType);
}
