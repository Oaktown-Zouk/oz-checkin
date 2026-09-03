import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toRestFields } from "./restFields.js";

describe("toRestFields", () => {
  it("flattens a select field's {name} shape to a plain string", () => {
    assert.deepEqual(toRestFields({ Status: { name: "active" } }), { Status: "active" });
  });
  it("leaves link fields (arrays of {id}) untouched", () => {
    const fields = { Member: [{ id: "recAbc123" }] };
    assert.deepEqual(toRestFields(fields), fields);
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
