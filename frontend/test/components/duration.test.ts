import { expect, test } from "vitest";
import {
  durationFromSeconds,
  durationSeconds,
  emptyDuration,
  formatDuration,
  maximumDurationHours,
} from "../../src/components/duration";

// Test exact second roundtrips, including zero, elapsed hours beyond a day, and the storage limit.
test.each([0, 1, 59, 60, 3600, 94530, Number.MAX_SAFE_INTEGER])(
  "roundtrips %i duration seconds",
  (seconds) => {
    expect(durationSeconds(durationFromSeconds(seconds))).toBe(seconds);
  },
);

// Test unset versus explicit zero and interpreting unfilled components without rewriting input.
test("distinguishes unset durations from explicit zero and combines partial inputs", () => {
  expect(durationSeconds(emptyDuration())).toBeNull();
  expect(durationSeconds({ hours: "", minutes: "30", seconds: "" })).toBe(1800);
  expect(durationSeconds({ hours: "0", minutes: "", seconds: "" })).toBe(0);
  expect(durationFromSeconds(94530)).toEqual({
    hours: "26",
    minutes: "15",
    seconds: "30",
  });
});

// Test malformed components and totals exceeding the backend's safe integer range.
test.each([
  { hours: "-1", minutes: "", seconds: "" },
  { hours: "1.5", minutes: "", seconds: "" },
  { hours: "1e2", minutes: "", seconds: "" },
  { hours: "01", minutes: "", seconds: "" },
  { hours: "", minutes: "60", seconds: "" },
  { hours: "", minutes: "", seconds: "60" },
  { hours: String(maximumDurationHours + 1), minutes: "", seconds: "" },
  { hours: String(maximumDurationHours), minutes: "59", seconds: "59" },
])("rejects an invalid duration %j", (value) => {
  expect(durationSeconds(value)).toBeNull();
});

// Test readable, locale-aware display without losing zero or wrapping hours at midnight.
test("formats zero, partial durations, and hours greater than 24", () => {
  expect(formatDuration(0, "en")).toBe("0 s");
  expect(formatDuration(1800, "de")).toBe("30 min");
  expect(formatDuration(94530, "en")).toBe("26 h 15 min 30 s");
  expect(formatDuration(1000 * 3600, "de")).toBe("1.000 h");
});
