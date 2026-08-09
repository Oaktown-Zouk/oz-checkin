// Dev-only: populates the local SQLite DB with sample students so the UI can be
// exercised without live Google Forms / Givebutter credentials. Wipes existing data —
// never run this against a database with real check-in history.
import { eq } from "drizzle-orm";
import { db } from "./client.js";
import { checkins, givebutterContacts, memberships, payments, students, waivers } from "./schema.js";
import { today } from "../lib/date.js";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

async function seed() {
  console.log("Wiping existing data...");
  await db.delete(checkins);
  await db.delete(payments);
  await db.delete(memberships);
  await db.delete(waivers);
  await db.delete(givebutterContacts);
  await db.delete(students);

  console.log("Inserting sample students...");

  // 1. Active member, waiver signed, not checked in yet.
  const [ana] = await db
    .insert(students)
    .values({ email: "ana@example.com", name: "Ana Alvarez" })
    .returning();
  await db.insert(waivers).values({
    studentId: ana.id,
    formResponseId: "resp-ana-1",
    signedAt: daysAgo(30),
  });
  await db.insert(memberships).values({
    studentId: ana.id,
    givebutterPlanId: "plan-ana-1",
    status: "active",
    frequency: "monthly",
    amountCents: 8000,
  });

  // 2. One-time payer with 2 unredeemed credits (bought a pass for a friend), waiver
  //    signed — this is the "let a friend use one" scenario from the spec.
  const [ben] = await db
    .insert(students)
    .values({ email: "ben@example.com", name: "Ben Brooks" })
    .returning();
  await db.insert(waivers).values({
    studentId: ben.id,
    formResponseId: "resp-ben-1",
    signedAt: daysAgo(10),
  });
  await db.insert(payments).values([
    { studentId: ben.id, givebutterTransactionId: "txn-ben-1", amountCents: 2000, paidAt: daysAgo(5) },
    { studentId: ben.id, givebutterTransactionId: "txn-ben-2", amountCents: 2000, paidAt: daysAgo(5) },
  ]);

  // 3. One-time payer, single credit, waiver signed.
  const [carla] = await db
    .insert(students)
    .values({ email: "carla@example.com", name: "Carla Chen" })
    .returning();
  await db.insert(waivers).values({
    studentId: carla.id,
    formResponseId: "resp-carla-1",
    signedAt: daysAgo(2),
  });
  await db.insert(payments).values({
    studentId: carla.id,
    givebutterTransactionId: "txn-carla-1",
    amountCents: 2000,
    paidAt: daysAgo(2),
  });

  // 4. Waiver signed, no payment on file at all — should flag red.
  const [dev] = await db
    .insert(students)
    .values({ email: "dev@example.com", name: "Devon Diaz" })
    .returning();
  await db.insert(waivers).values({
    studentId: dev.id,
    formResponseId: "resp-dev-1",
    signedAt: daysAgo(1),
  });

  // 5. Payment on file, no waiver — should flag red on waiver.
  const [erin] = await db
    .insert(students)
    .values({ email: "erin@example.com", name: "Erin Evans" })
    .returning();
  await db.insert(payments).values({
    studentId: erin.id,
    givebutterTransactionId: "txn-erin-1",
    amountCents: 2000,
    paidAt: daysAgo(3),
  });

  // 6. Neither waiver nor payment — worst case, front desk override territory.
  await db.insert(students).values({ email: "frank@example.com", name: "Frank Ford" });

  // 7. Already checked in today via active membership — grayed out, no "use another
  //    pass" (membership doesn't consume anything).
  const [grace] = await db
    .insert(students)
    .values({ email: "grace@example.com", name: "Grace Gomez" })
    .returning();
  await db.insert(waivers).values({
    studentId: grace.id,
    formResponseId: "resp-grace-1",
    signedAt: daysAgo(60),
  });
  await db.insert(memberships).values({
    studentId: grace.id,
    givebutterPlanId: "plan-grace-1",
    status: "active",
    frequency: "monthly",
    amountCents: 8000,
  });
  await db.insert(checkins).values({ studentId: grace.id, date: today(), checkedInBy: "front-desk" });

  // 8. Checked in once already today via a one-time credit, one credit still
  //    unredeemed — grayed out but "Use another pass" should stay active.
  const [hank] = await db
    .insert(students)
    .values({ email: "hank@example.com", name: "Hank Hill" })
    .returning();
  await db.insert(waivers).values({
    studentId: hank.id,
    formResponseId: "resp-hank-1",
    signedAt: daysAgo(15),
  });
  const [hankPaymentUsed] = await db
    .insert(payments)
    .values([
      { studentId: hank.id, givebutterTransactionId: "txn-hank-1", amountCents: 2000, paidAt: daysAgo(4) },
      { studentId: hank.id, givebutterTransactionId: "txn-hank-2", amountCents: 2000, paidAt: daysAgo(4) },
    ])
    .returning();
  const [hankCheckin] = await db
    .insert(checkins)
    .values({
      studentId: hank.id,
      date: today(),
      checkedInBy: "front-desk",
      paymentId: hankPaymentUsed.id,
    })
    .returning();
  await db
    .update(payments)
    .set({ redeemedAt: new Date(), redeemedByCheckinId: hankCheckin.id })
    .where(eq(payments.id, hankPaymentUsed.id));

  console.log("Seed complete: 8 sample students inserted.");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
