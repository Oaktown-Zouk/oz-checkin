import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toText, toDateOnly, toBoolean, normalizeSelectText, toSelectField } from "./text.js";

describe("toText", () => {
  it("stringifies and trims", () => {
    assert.equal(toText("  hi  "), "hi");
    assert.equal(toText(42), "42");
  });
  it("treats null/undefined as empty string", () => {
    assert.equal(toText(null), "");
    assert.equal(toText(undefined), "");
  });
});

describe("toDateOnly", () => {
  it("takes the first 10 characters of an ISO timestamp", () => {
    assert.equal(toDateOnly("2026-09-02T17:53:43.000Z"), "2026-09-02");
  });
  it("returns null for falsy input", () => {
    assert.equal(toDateOnly(null), null);
    assert.equal(toDateOnly(""), null);
    assert.equal(toDateOnly(undefined), null);
  });
});

describe("toBoolean", () => {
  it("passes real booleans through", () => {
    assert.equal(toBoolean(true), true);
    assert.equal(toBoolean(false), false);
  });
  it("does NOT fall into the native Boolean('false') === true trap", () => {
    assert.equal(toBoolean("false"), false);
  });
  it("recognizes common truthy string spellings, case-insensitively", () => {
    for (const value of ["true", "TRUE", "1", "yes", "Yes", "y"]) {
      assert.equal(toBoolean(value), true, `expected ${value} to be true`);
    }
  });
  it("treats unrecognized strings, null, and undefined as false", () => {
    assert.equal(toBoolean("no"), false);
    assert.equal(toBoolean("0"), false);
    assert.equal(toBoolean(""), false);
    assert.equal(toBoolean(null), false);
    assert.equal(toBoolean(undefined), false);
  });
});

describe("normalizeSelectText", () => {
  it("trims and returns null for blank/whitespace-only values", () => {
    assert.equal(normalizeSelectText("  Active  "), "Active");
    assert.equal(normalizeSelectText(""), null);
    assert.equal(normalizeSelectText("   "), null);
    assert.equal(normalizeSelectText(null), null);
  });
});

describe("toSelectField", () => {
  it("wraps a non-blank value in the {name} write format", () => {
    assert.deepEqual(toSelectField("active"), { name: "active" });
    assert.deepEqual(toSelectField("  active  "), { name: "active" });
  });
  it("returns null for blank/null values instead of an empty-name object", () => {
    assert.equal(toSelectField(""), null);
    assert.equal(toSelectField(null), null);
  });
});
