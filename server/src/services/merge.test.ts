import { before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  setupTestDb,
  resetDb,
  insertStudent,
  insertWaiver,
  insertMembership,
  insertPayment,
  insertGivebutterContact,
  insertCheckin,
  insertPromoCredit,
} from "../testing/helpers.js";
import { mergeStudents } from "./merge.js";
import { findStudentIdByEmail } from "../lib/upsertStudent.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { db } from "../db/client.js";
import { promoCredits, payments, memberships } from "../db/schema.js";
import { eq } from "drizzle-orm";

before(setupTestDb);
beforeEach(resetDb);

describe("mergeStudents — happy path", () => {
  it("combines a Forms-only student with a Givebutter-only student", async () => {
    const formsStudent = await insertStudent("aastha.personal@gmail.com", "Aastha Sehgal");
    await insertWaiver(formsStudent, { signedAt: new Date("2026-08-01") });

    const gbStudent = await insertStudent("aastha.work@company.com", "Aastha S.");
    await insertMembership(gbStudent, { status: "active" });
    await insertGivebutterContact(gbStudent, "contact-1");

    const merged = await mergeStudents(formsStudent, "aastha.work@company.com");

    assert.equal(merged.id, formsStudent, "the survivor is the one whose menu was opened");
    assert.equal(merged.waiver.signed, true);
    assert.equal(merged.membership?.active, true);
    assert.deepEqual(merged.alternateEmails, ["aastha.work@company.com"]);
  });

  it("reassigns check-in history from the absorbed student", async () => {
    const formsStudent = await insertStudent("a@example.com");
    await insertWaiver(formsStudent);

    const gbStudent = await insertStudent("b@example.com");
    const paymentId = await insertPayment(gbStudent);
    await insertCheckin(gbStudent, { paymentId });

    const merged = await mergeStudents(formsStudent, "b@example.com");

    assert.equal(merged.checkedInToday, true);
    assert.equal(merged.checkinsToday[0].paymentId, paymentId);
  });

  it("deletes the absorbed student row", async () => {
    const formsStudent = await insertStudent("a@example.com");
    await insertWaiver(formsStudent);
    const gbStudent = await insertStudent("b@example.com");
    await insertMembership(gbStudent);

    await mergeStudents(formsStudent, "b@example.com");

    // The absorbed student's own id no longer resolves to itself as a live student —
    // it now resolves (via the linked email) to the survivor.
    const resolvedId = await findStudentIdByEmail("b@example.com");
    assert.equal(resolvedId, formsStudent);
  });

  it("the merge sticks: a future sync recognizes the absorbed email as already-known", async () => {
    const formsStudent = await insertStudent("a@example.com");
    await insertWaiver(formsStudent);
    const gbStudent = await insertStudent("b@example.com");
    await insertMembership(gbStudent);

    await mergeStudents(formsStudent, "b@example.com");

    // This is exactly what sync's upsertStudent does on every run — simulate it
    // directly against the lookup the merge is supposed to fix.
    const idForOldEmail = await findStudentIdByEmail("b@example.com");
    const idForOriginalEmail = await findStudentIdByEmail("a@example.com");
    assert.equal(idForOldEmail, idForOriginalEmail, "both emails now resolve to the same student");
  });

  it("a student who already absorbed one merge can't be merged again (guardrail prevents chains)", async () => {
    // Once a student has both a waiver and Givebutter data (from one legitimate merge),
    // it no longer fits either half of the "exactly one gap" rule, so it can't be pulled
    // into a second merge — a structural property of the guardrail worth locking in.
    const a = await insertStudent("a@example.com");
    await insertWaiver(a);
    const b = await insertStudent("b@example.com");
    await insertMembership(b);
    await mergeStudents(a, "b@example.com");

    const c = await insertStudent("c@example.com");
    await insertMembership(c);

    await assert.rejects(() => mergeStudents(a, "c@example.com"), ConflictError);
  });
});

describe("mergeStudents — name reconciliation (Givebutter is payment-verified)", () => {
  it("adopts the absorbed student's name when it's Givebutter-sourced and the survivor's isn't", async () => {
    const survivor = await insertStudent("hanna.personal@example.com", "Hanna", "google_forms");
    await insertWaiver(survivor);
    const other = await insertStudent("hanna.gb@example.com", "Hanna Larracas", "givebutter");
    await insertMembership(other);

    const merged = await mergeStudents(survivor, "hanna.gb@example.com");

    assert.equal(merged.name, "Hanna Larracas");
  });

  it("does NOT downgrade a Givebutter-sourced survivor name to the absorbed Forms name", async () => {
    const survivor = await insertStudent("hanna.gb@example.com", "Hanna Larracas", "givebutter");
    await insertMembership(survivor);
    const other = await insertStudent("hanna.personal@example.com", "Hanna", "google_forms");
    await insertWaiver(other);

    const merged = await mergeStudents(survivor, "hanna.personal@example.com");

    assert.equal(merged.name, "Hanna Larracas");
  });

  it("leaves the name alone when both sides already agree", async () => {
    const survivor = await insertStudent("a@example.com", "Hanna Larracas", "google_forms");
    await insertWaiver(survivor);
    const other = await insertStudent("b@example.com", "Hanna Larracas", "givebutter");
    await insertMembership(other);

    const merged = await mergeStudents(survivor, "b@example.com");

    assert.equal(merged.name, "Hanna Larracas");
  });
});

describe("mergeStudents — promo credits", () => {
  it("reassigns the absorbed student's promo credit when the survivor doesn't have one for that reason", async () => {
    const survivor = await insertStudent("a@example.com");
    await insertWaiver(survivor);
    const other = await insertStudent("b@example.com");
    await insertMembership(other);
    const otherCreditId = await insertPromoCredit(other);

    await mergeStudents(survivor, "b@example.com");

    const [credit] = await db.select().from(promoCredits).where(eq(promoCredits.id, otherCreditId));
    assert.equal(credit.studentId, survivor);
  });

  it("drops the absorbed student's duplicate promo credit when the survivor already has one for the same reason (no double freebie)", async () => {
    // Both sides get a "new_student" grant independently in real usage — the merge
    // exists to fix one real person being represented twice, not to double the
    // one-per-student freebie, and the unique (studentId, reason) index would reject
    // a straight reassignment here anyway.
    const survivor = await insertStudent("a@example.com");
    await insertWaiver(survivor);
    const survivorCreditId = await insertPromoCredit(survivor);
    const other = await insertStudent("b@example.com");
    await insertMembership(other);
    const otherCreditId = await insertPromoCredit(other);

    await mergeStudents(survivor, "b@example.com");

    const remaining = await db.select().from(promoCredits).where(eq(promoCredits.studentId, survivor));
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, survivorCreditId, "the survivor's own grant is kept");

    const dropped = await db.select().from(promoCredits).where(eq(promoCredits.id, otherCreditId));
    assert.equal(dropped.length, 0, "the absorbed duplicate is gone, not orphaned");
  });

  it("merging still succeeds when neither side has a promo credit", async () => {
    const survivor = await insertStudent("a@example.com");
    await insertWaiver(survivor);
    const other = await insertStudent("b@example.com");
    await insertMembership(other);

    const merged = await mergeStudents(survivor, "b@example.com");
    assert.equal(merged.id, survivor);
  });
});

describe("mergeStudents — holder/payer split (transferred items)", () => {
  it("moves holderStudentId to the survivor when the absorbed student holds a transferred item", async () => {
    // "otherId" is the CURRENT HOLDER of a membership someone else (a third party) paid
    // for — i.e. it was transferred to otherId before this merge.
    const survivor = await insertStudent("a@example.com");
    await insertWaiver(survivor);
    const other = await insertStudent("b@example.com");
    const thirdParty = await insertStudent("c@example.com");
    const membershipId = await insertMembership(thirdParty, { holderStudentId: other });

    await mergeStudents(survivor, "b@example.com");

    const [row] = await db.select().from(memberships).where(eq(memberships.id, membershipId));
    assert.equal(row.holderStudentId, survivor, "the survivor now holds it");
    assert.equal(row.studentId, thirdParty, "the real payer is untouched");
  });

  it("moves studentId (payer) to the survivor when the absorbed student paid for someone else's item", async () => {
    const survivor = await insertStudent("a@example.com");
    await insertWaiver(survivor);
    const other = await insertStudent("b@example.com");
    const thirdParty = await insertStudent("c@example.com");
    const paymentId = await insertPayment(other, { holderStudentId: thirdParty });

    await mergeStudents(survivor, "b@example.com");

    const [row] = await db.select().from(payments).where(eq(payments.id, paymentId));
    assert.equal(row.studentId, survivor, "the survivor is now recorded as the real payer");
    assert.equal(row.holderStudentId, thirdParty, "the actual holder is untouched");
  });

  it("moves both fields when the absorbed student was both payer and holder (no prior transfer)", async () => {
    const survivor = await insertStudent("a@example.com");
    await insertWaiver(survivor);
    const other = await insertStudent("b@example.com");
    const paymentId = await insertPayment(other);

    await mergeStudents(survivor, "b@example.com");

    const [row] = await db.select().from(payments).where(eq(payments.id, paymentId));
    assert.equal(row.studentId, survivor);
    assert.equal(row.holderStudentId, survivor);
  });
});

describe("mergeStudents — guardrails", () => {
  it("blocks merging two students that both already have Givebutter data", async () => {
    const s1 = await insertStudent("one@example.com");
    await insertMembership(s1);
    const s2 = await insertStudent("two@example.com");
    await insertPayment(s2);

    await assert.rejects(() => mergeStudents(s1, "two@example.com"), ConflictError);
  });

  it("blocks merging two students that both already have Forms data", async () => {
    const s1 = await insertStudent("one@example.com");
    await insertWaiver(s1);
    const s2 = await insertStudent("two@example.com");
    await insertWaiver(s2);

    await assert.rejects(() => mergeStudents(s1, "two@example.com"), ConflictError);
  });

  it("treats a bare givebutter_contacts link (no payments/memberships yet) as 'has Givebutter'", async () => {
    const s1 = await insertStudent("one@example.com");
    await insertGivebutterContact(s1); // contact on file, never paid
    const s2 = await insertStudent("two@example.com");
    await insertMembership(s2);

    await assert.rejects(() => mergeStudents(s1, "two@example.com"), ConflictError);
  });

  it("throws NotFoundError when no student has the given email", async () => {
    const s1 = await insertStudent("one@example.com");
    await insertWaiver(s1);

    await assert.rejects(() => mergeStudents(s1, "nobody@example.com"), NotFoundError);
  });

  it("throws ConflictError when merging a student with itself", async () => {
    const s1 = await insertStudent("one@example.com");
    await insertWaiver(s1);

    await assert.rejects(() => mergeStudents(s1, "one@example.com"), ConflictError);
  });

  it("throws NotFoundError for an unknown survivor id", async () => {
    const s2 = await insertStudent("two@example.com");
    await insertWaiver(s2);

    await assert.rejects(() => mergeStudents(999_999, "two@example.com"), NotFoundError);
  });
});
