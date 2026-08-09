import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, today } from "./date.js";

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
