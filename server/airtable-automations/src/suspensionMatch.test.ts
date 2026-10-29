import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesSuspension, normalizeName, suspensionNames } from "./suspensionMatch.js";

const suspension = { firstName: "José", lastName: "O'Brien", otherNames: "" };

describe("normalizeName", () => {
  it("ignores case, accents, punctuation, and spacing", () => {
    assert.equal(normalizeName("  José   O'Brien-Smith "), "jose obriensmith");
  });
});

describe("suspensionNames", () => {
  it("includes the main name and every Other Names line with a first and last name", () => {
    const names = suspensionNames({ ...suspension, otherNames: "Joe O'Brien\n\nOBrien\n  Pepe  Smith " });
    assert.deepEqual([...names].sort(), ["joe obrien", "jose obrien", "pepe smith"]);
  });

  it("drops a main name missing its first or last half", () => {
    assert.equal(suspensionNames({ ...suspension, firstName: "" }).size, 0);
  });
});

describe("matchesSuspension", () => {
  it("matches the full name, normalized", () => {
    assert.equal(matchesSuspension(suspension, { firstName: "jose", lastName: "obrien" }), true);
  });

  it("matches an Other Names variant", () => {
    const s = { ...suspension, otherNames: "Joe OBrien" };
    assert.equal(matchesSuspension(s, { firstName: "Joe", lastName: "O'Brien" }), true);
  });

  it("doesn't match a first name alone, or a blank name", () => {
    assert.equal(matchesSuspension(suspension, { firstName: "José", lastName: "Garcia" }), false);
    assert.equal(matchesSuspension(suspension, { firstName: "", lastName: "" }), false);
  });
});
