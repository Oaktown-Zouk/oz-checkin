import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toRestFields } from "./restFields.js";

describe("toRestFields", () => {
  it("flattens a select field's {name} shape to a plain string", () => {
    assert.deepEqual(toRestFields({ Status: { name: "active" } }), { Status: "active" });
  });
  it("flattens a link field's [{id}] shape to a plain array of id strings", () => {
    assert.deepEqual(toRestFields({ Member: [{ id: "recAbc123" }] }), { Member: ["recAbc123"] });
  });
  it("flattens a multi-record link field, preserving order", () => {
    assert.deepEqual(toRestFields({ Member: [{ id: "recA" }, { id: "recB" }] }), { Member: ["recA", "recB"] });
  });
  it("leaves an empty link array as an empty array", () => {
    assert.deepEqual(toRestFields({ Member: [] }), { Member: [] });
  });
  it("leaves plain strings, numbers, booleans, and null untouched", () => {
    const fields = { Amount: 95, "Fee Covered": true, Method: "card", "Canceled At": null };
    assert.deepEqual(toRestFields(fields), fields);
  });
  it("leaves an object with more than just a name key untouched -- not a select cell value", () => {
    const fields = { Weird: { name: "x", extra: "y" } };
    assert.deepEqual(toRestFields(fields), fields);
  });
  it("does not mutate the input object", () => {
    const fields = { Status: { name: "active" } };
    toRestFields(fields);
    assert.deepEqual(fields, { Status: { name: "active" } });
  });
});
