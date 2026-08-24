import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.js";

describe("hashPassword / verifyPassword", () => {
  it("round-trips: the correct password verifies", async () => {
    const stored = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("correct horse battery staple", stored), true);
  });

  it("rejects a wrong password", async () => {
    const stored = await hashPassword("correct horse battery staple");
    assert.equal(await verifyPassword("wrong password", stored), false);
  });

  it("produces a different hash each time for the same password (random salt)", async () => {
    const a = await hashPassword("same password");
    const b = await hashPassword("same password");
    assert.notEqual(a, b);
    // Both still verify correctly despite differing.
    assert.equal(await verifyPassword("same password", a), true);
    assert.equal(await verifyPassword("same password", b), true);
  });

  it("is case- and whitespace-sensitive", async () => {
    const stored = await hashPassword("Password123");
    assert.equal(await verifyPassword("password123", stored), false);
    assert.equal(await verifyPassword("Password123 ", stored), false);
  });

  it("rejects malformed stored values instead of throwing", async () => {
    await assert.doesNotReject(async () => {
      assert.equal(await verifyPassword("anything", "not-a-real-hash"), false);
      assert.equal(await verifyPassword("anything", ""), false);
      assert.equal(await verifyPassword("anything", "scrypt:not:numbers:here:zz:zz"), false);
      assert.equal(await verifyPassword("anything", "bcrypt:16384:8:1:aa:bb"), false); // wrong algorithm tag
    });
  });
});
