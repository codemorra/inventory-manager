import { expect, test } from "vitest";
import {
  isUrlInput,
  isWebAddress,
  urlDisplayText,
} from "../../src/components/url";

// Test accepted destinations match the backend's explicit HTTP(S) contract.
test.each([
  "https://example.com/docs?q=1#help",
  "http://localhost:8000",
  "HTTPS://example.com",
  "https://example.com/a%20b",
  "https://例え.jp",
])("accepts web address %s", (value) => {
  expect(isWebAddress(value)).toBe(true);
});

// Test unsafe schemes and malformed destinations never become clickable links.
test.each([
  "",
  "example.com",
  "/relative",
  "//example.com",
  "https://",
  "https:///",
  "javascript:alert(1)",
  "data:text/html,test",
  "file:///etc/passwd",
  "ftp://example.com",
  " https://example.com",
  "https://example.com/a b",
  "https://example.com\n",
  "https://example.com/\u0001",
  "https://example.com/\u007f",
])("rejects unsafe or incomplete address %s", (value) => {
  expect(isWebAddress(value)).toBe(false);
});

// Test unknown API data is never coerced into link destinations or HTML labels.
test("recognizes structured links and selects their visible text", () => {
  for (const value of [
    null,
    [],
    "https://example.com",
    {},
    { url: 42 },
    { url: "https://example.com", label: false },
    { url: "https://example.com", extra: true },
  ])
    expect(isUrlInput(value)).toBe(false);
  expect(isUrlInput({ url: "https://example.com" })).toBe(true);
  expect(
    isUrlInput({ url: "https://example.com", label: "Documentation" }),
  ).toBe(true);
  expect(
    urlDisplayText({ url: "https://example.com", label: "Documentation" }),
  ).toBe("Documentation");
  expect(urlDisplayText({ url: "https://example.com", label: "   " })).toBe(
    "https://example.com",
  );
});
