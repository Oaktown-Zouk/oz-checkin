import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, resetDb, insertStudent } from "../testing/helpers.js";
import { findStudentIdByEmail } from "./upsertStudent.js";

before(setupTestDb);
beforeEach(resetDb);

describe("findStudentIdByEmail", () => {
  it("returns undefined when nothing matches", async () => {
    const id = await findStudentIdByEmail("nobody@example.com");
    assert.equal(id, undefined);
  });

  it("normalizes the lookup email", async () => {
    const existingId = await insertStudent("case@example.com");

    const id = await findStudentIdByEmail("  CASE@Example.com  ");

    assert.equal(id, existingId);
  });
});
