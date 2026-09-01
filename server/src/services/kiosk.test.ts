import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { TABLES } from "../airtable/tableIds.js";
import { listKioskRoster } from "./kiosk.js";

describe("listKioskRoster", () => {
  it("includes every non-duplicate student, eligible or not", async () => {
    resetMockStore({
      [TABLES.members]: [
        { id: "recEligible", fields: { "Full Name": "Eligible Student", "Classes Allowed": 1 } },
        { id: "recIneligible", fields: { "Full Name": "Ineligible Student", "Classes Allowed": 0 } },
        { id: "recDup", fields: { "Full Name": "Duplicate", "Classes Allowed": 1, Duplicate: true } },
      ],
    });

    const roster = await listKioskRoster();
    assert.deepEqual(
      roster.map((r) => r.id).sort(),
      ["recEligible", "recIneligible"]
    );
  });

  it("returns the minimal shape (no email/tier/badges)", async () => {
    resetMockStore({
      [TABLES.members]: [
        {
          id: "recMember1",
          fields: {
            "Full Name": "Test Student",
            Email: "should-not-appear@example.com",
            "Contact ID": "contact-1",
            "Classes Allowed": 2,
            "Membership Status": "Active",
          },
        },
      ],
    });

    const [entry] = await listKioskRoster();
    assert.deepEqual(Object.keys(entry).sort(), ["availableCredits", "id", "membershipStatus", "name", "remaining"]);
    assert.equal(entry.remaining, 2);
  });
});
