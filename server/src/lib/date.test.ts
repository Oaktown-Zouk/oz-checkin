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

  it("matches the current Pacific-time date, not the server's local/UTC date", () => {
    const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    assert.equal(today(), expected);
  });
});

describe("dateStringFor", () => {
  // Fixed instants (explicit UTC offsets) so these assertions don't depend on the
  // machine running the test — dateStringFor must always resolve to Pacific time
  // regardless of the server's own timezone (see the comment on STUDIO_TIMEZONE).
  it("formats an arbitrary instant in Pacific time as YYYY-MM-DD, zero-padded", () => {
    // 2026-01-05T09:00:00-08:00 (PST, UTC-8 in January) == 2026-01-05T17:00:00Z
    assert.equal(dateStringFor(new Date("2026-01-05T17:00:00Z")), "2026-01-05");
  });

  it("rolls back a calendar day for a late-evening Pacific instant already past midnight UTC", () => {
    // 2026-08-13T20:00:00-07:00 (PDT, UTC-7 in August) == 2026-08-14T03:00:00Z — UTC's
    // calendar day is already the 14th, but the studio's is still the 13th.
    assert.equal(dateStringFor(new Date("2026-08-14T03:00:00Z")), "2026-08-13");
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
