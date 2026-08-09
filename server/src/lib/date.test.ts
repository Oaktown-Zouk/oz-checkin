import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, today, dateStringFor, isValidDateString } from "./date.js";

describe("normalizeEmail", () => {
  it("trims whitespace", () => {
    assert.equal(normalizeEmail("  foo@bar.com  "), "foo@bar.com");
  });

  it("lowercases", () => {
    assert.equal(normalizeEmail("Foo@Bar.COM"), "foo@bar.com");
  });

  it("does both at once", () => {
    assert.equal(normalizeEmail("  Foo.Bar@Example.COM  "), "foo.bar@example.com");
  });
});

describe("today", () => {
  it("returns a YYYY-MM-DD string", () => {
    assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches the current local date", () => {
    const d = new Date();
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    assert.equal(today(), expected);
  });
});

describe("dateStringFor", () => {
  it("formats an arbitrary date as YYYY-MM-DD, zero-padded", () => {
    assert.equal(dateStringFor(new Date("2026-01-05T09:00:00")), "2026-01-05");
  });

  it("uses the date's own local day, not the day of `today()`", () => {
    assert.equal(dateStringFor(new Date("2020-03-15T00:00:00")), "2020-03-15");
  });
});

describe("isValidDateString", () => {
  it("accepts YYYY-MM-DD", () => {
    assert.equal(isValidDateString("2026-08-01"), true);
  });

  it("rejects other formats", () => {
    assert.equal(isValidDateString("2026-8-1"), false);
    assert.equal(isValidDateString("08/01/2026"), false);
    assert.equal(isValidDateString("not-a-date"), false);
    assert.equal(isValidDateString(""), false);
  });
});
