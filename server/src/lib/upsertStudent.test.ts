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
    const id = await upsertStudent("new@example.com", "New Student", "google_forms");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.email, "new@example.com");
    assert.equal(row.name, "New Student");
    assert.equal(row.nameSource, "google_forms");
  });

  it("normalizes email (trim + lowercase) both on create and on lookup", async () => {
    const id1 = await upsertStudent("  Foo@Bar.COM  ", "Foo", "google_forms");
    const id2 = await upsertStudent("foo@bar.com", "Foo Again", "google_forms");

    assert.equal(id1, id2);
  });

  it("matches an existing student by their primary email", async () => {
    const existingId = await insertStudent("existing@example.com", "Existing");

    const id = await upsertStudent("existing@example.com", "Existing Updated", "google_forms");

    assert.equal(id, existingId);
  });

  it("matches an existing student by a linked alternate email", async () => {
    const existingId = await insertStudent("primary@example.com", "Primary");
    await insertStudentEmail(existingId, "alt@example.com");

    const id = await upsertStudent("alt@example.com", "Some Name", "google_forms");

    assert.equal(id, existingId, "resolves to the same student via the linked email");

    // And doesn't create a second student row for the alternate email.
    const all = await db.select().from(students);
    assert.equal(all.length, 1);
  });

  it("updates the student's name when it changed", async () => {
    const id = await insertStudent("a@example.com", "Old Name");

    await upsertStudent("a@example.com", "New Name", "google_forms");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.name, "New Name");
  });

  it("falls back to the email as the name when no name is given for a new student", async () => {
    const id = await upsertStudent("noname@example.com", "", "google_forms");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.name, "noname@example.com");
  });
});

describe("upsertStudent — name source priority (Givebutter is payment-verified)", () => {
  it("a Google Forms sync sets the name and records the source, when nothing else has", async () => {
    const id = await upsertStudent("hanna@example.com", "Hanna", "google_forms");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.name, "Hanna");
    assert.equal(row.nameSource, "google_forms");
  });

  it("a later Givebutter sync overwrites a Forms-set name", async () => {
    const id = await insertStudent("hanna@example.com", "Hanna", "google_forms");

    await upsertStudent("hanna@example.com", "Hanna Larracas", "givebutter");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.name, "Hanna Larracas");
    assert.equal(row.nameSource, "givebutter");
  });

  it("a later Google Forms sync does NOT downgrade a Givebutter-set name", async () => {
    const id = await insertStudent("hanna@example.com", "Hanna Larracas", "givebutter");

    await upsertStudent("hanna@example.com", "Hanna", "google_forms");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.name, "Hanna Larracas", "the payment-verified name is kept");
    assert.equal(row.nameSource, "givebutter");
  });

  it("this converges correctly regardless of which source syncs first", async () => {
    // Givebutter-first ordering (see the previous two tests for Forms-first).
    const id = await upsertStudent("hanna@example.com", "Hanna Larracas", "givebutter");
    await upsertStudent("hanna@example.com", "Hanna", "google_forms");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.name, "Hanna Larracas");
  });

  it("a repeat Givebutter sync with the same name is a no-op, not an error", async () => {
    const id = await insertStudent("hanna@example.com", "Hanna Larracas", "givebutter");

    await upsertStudent("hanna@example.com", "Hanna Larracas", "givebutter");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.name, "Hanna Larracas");
  });

  it("stamps nameSource on a Givebutter sync even when the name text already matches (backfill case)", async () => {
    // Rows that predate name-source tracking (or were backfilled by the migration
    // that added the column) have nameSource = null even though their name may
    // already be the Givebutter-correct one — e.g. it was set that way by an old
    // sync, before this tracking existed. Without this, such a row stays
    // unprotected forever, since a plain text match never triggers an update.
    const id = await insertStudent("hanna@example.com", "Hanna Larracas", null);

    await upsertStudent("hanna@example.com", "Hanna Larracas", "givebutter");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.name, "Hanna Larracas");
    assert.equal(row.nameSource, "givebutter");
  });

  it("upgrades a Forms-sourced row to givebutter source when the name already happens to match", async () => {
    // A Forms-sourced row whose name happens to already equal what Givebutter has
    // should still get upgraded to nameSource: "givebutter" — that's what makes it
    // protected against a future Forms downgrade.
    const id = await insertStudent("hanna@example.com", "Hanna Larracas", "google_forms");

    await upsertStudent("hanna@example.com", "Hanna Larracas", "givebutter");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.nameSource, "givebutter");
  });

  it("does not touch a row whose source is already givebutter and name is unchanged", async () => {
    const id = await insertStudent("hanna@example.com", "Hanna Larracas", "givebutter");

    await upsertStudent("hanna@example.com", "Hanna Larracas", "givebutter");

    const [row] = await db.select().from(students).where(eq(students.id, id));
    assert.equal(row.name, "Hanna Larracas");
    assert.equal(row.nameSource, "givebutter");
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
