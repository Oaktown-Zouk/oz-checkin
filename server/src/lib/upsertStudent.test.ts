import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, resetDb, insertStudent, insertStudentEmail } from "../testing/helpers.js";
import { upsertStudent, findStudentIdByEmail } from "./upsertStudent.js";
import { db } from "../db/client.js";
import { students } from "../db/schema.js";
import { eq } from "drizzle-orm";

before(setupTestDb);
beforeEach(resetDb);

describe("upsertStudent", () => {
  it("creates a new student when the email hasn't been seen", async () => {
    const id = await upsertStudent("new@example.com", "New Student");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.email, "new@example.com");
    assert.equal(row.name, "New Student");
  });

  it("normalizes email (trim + lowercase) both on create and on lookup", async () => {
    const id1 = await upsertStudent("  Foo@Bar.COM  ", "Foo");
    const id2 = await upsertStudent("foo@bar.com", "Foo Again");

    assert.equal(id1, id2);
  });

  it("matches an existing student by their primary email", async () => {
    const existingId = await insertStudent("existing@example.com", "Existing");

    const id = await upsertStudent("existing@example.com", "Existing Updated");

    assert.equal(id, existingId);
  });

  it("matches an existing student by a linked alternate email", async () => {
    const existingId = await insertStudent("primary@example.com", "Primary");
    await insertStudentEmail(existingId, "alt@example.com");

    const id = await upsertStudent("alt@example.com", "Some Name");

    assert.equal(id, existingId, "resolves to the same student via the linked email");

    // And doesn't create a second student row for the alternate email.
    const all = await db.select().from(students);
    assert.equal(all.length, 1);
  });

  it("updates the student's name when it changed", async () => {
    const id = await insertStudent("a@example.com", "Old Name");

    await upsertStudent("a@example.com", "New Name");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.name, "New Name");
  });

  it("falls back to the email as the name when no name is given for a new student", async () => {
    const id = await upsertStudent("noname@example.com", "");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.name, "noname@example.com");
  });
});

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
