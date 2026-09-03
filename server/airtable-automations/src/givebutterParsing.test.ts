import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nameParts, tagList, flattenAddress } from "./givebutterParsing.js";

describe("nameParts", () => {
  it("prefers real first_name/last_name fields when present", () => {
    assert.deepEqual(nameParts({ first_name: "Maria", last_name: "Delgado" }), { first: "Maria", last: "Delgado" });
  });
  it("falls back to nested contact.first_name/last_name", () => {
    assert.deepEqual(nameParts({ contact: { first_name: "Maria", last_name: "Delgado" } }), {
      first: "Maria",
      last: "Delgado",
    });
  });
  it("keeps a lone first name rather than treating it as a full name to split", () => {
    assert.deepEqual(nameParts({ first_name: "Cher" }), { first: "Cher", last: "" });
  });
  it("splits a combined name on the LAST space -- a documented wrong answer for multi-word last names", () => {
    assert.deepEqual(nameParts({ contact: { name: "Ana van der Berg" } }), { first: "Ana van der", last: "Berg" });
  });
  it("treats a single-word combined name as first-name-only", () => {
    assert.deepEqual(nameParts({ name: "Cher" }), { first: "Cher", last: "" });
  });
  it("returns blanks when nothing is present at all", () => {
    assert.deepEqual(nameParts({}), { first: "", last: "" });
  });
});

describe("tagList", () => {
  it("returns an empty string for null/undefined", () => {
    assert.equal(tagList(null), "");
    assert.equal(tagList(undefined), "");
  });
  it("joins an array of plain strings", () => {
    assert.equal(tagList(["vip", "newsletter"]), "vip, newsletter");
  });
  it("joins an array of tag objects by name or label", () => {
    assert.equal(tagList([{ name: "VIP" }, { label: "Newsletter" }]), "VIP, Newsletter");
  });
  it("drops empty/unlabeled entries rather than emitting blank segments", () => {
    assert.equal(tagList(["vip", {}, "newsletter"]), "vip, newsletter");
  });
  it("passes a non-array value through toText unchanged", () => {
    assert.equal(tagList("vip,newsletter"), "vip,newsletter");
  });
});

describe("flattenAddress", () => {
  it("returns an empty string for a missing address", () => {
    assert.equal(flattenAddress(null), "");
    assert.equal(flattenAddress(undefined), "");
  });
  it("flattens a full address into three lines", () => {
    assert.equal(
      flattenAddress({ address_1: "123 Main St", address_2: "Apt 4", city: "Oakland", state: "CA", zipcode: "94612", country: "US" }),
      "123 Main St Apt 4\nOakland, CA\n94612 US"
    );
  });
  it("skips blank lines for missing sub-fields", () => {
    assert.equal(flattenAddress({ city: "Oakland" }), "Oakland");
  });
  it("falls back from zipcode to zip", () => {
    assert.equal(flattenAddress({ zip: "94612" }), "94612");
  });
});
