import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { missingSelectChoiceNames } from "./selectChoices.js";

describe("missingSelectChoiceNames", () => {
  it("returns nothing when every incoming value already exists", () => {
    assert.deepEqual(missingSelectChoiceNames([{ id: "1", name: "active" }], ["active"]), []);
  });
  it("returns a new value not already in the choice list", () => {
    assert.deepEqual(missingSelectChoiceNames([{ id: "1", name: "active" }], ["active", "paused"]), ["paused"]);
  });
  it("is case-sensitive -- 'Active' and 'active' are different choices", () => {
    assert.deepEqual(missingSelectChoiceNames([{ id: "1", name: "active" }], ["Active"]), ["Active"]);
  });
  it("ignores blank/whitespace-only and null values", () => {
    assert.deepEqual(missingSelectChoiceNames([], ["", "   ", null, undefined]), []);
  });
  it("trims trailing whitespace before comparing, since it's otherwise invisible", () => {
    assert.deepEqual(missingSelectChoiceNames([{ id: "1", name: "active" }], ["active  "]), []);
  });
  it("de-duplicates repeated missing values", () => {
    assert.deepEqual(missingSelectChoiceNames([], ["paused", "paused"]), ["paused"]);
  });
});
