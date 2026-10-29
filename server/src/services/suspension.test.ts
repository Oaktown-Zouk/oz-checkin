import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { listRecords } from "../airtable/client.js";
import { TABLES } from "../airtable/tableIds.js";
import type { SuspensionFields } from "../airtable/fields.js";
import { NotFoundError } from "../lib/errors.js";
import { today } from "../lib/date.js";
import { setSuspended } from "./suspension.js";

const MEMBER = "recMember1";
const STAFF = "recStaff1";
const MEMBER_FIELDS = { "Full Name": "Test Student", "First Name": "Test", "Last Name": "Student", Email: "t@example.com" };

async function suspensions() {
  return listRecords<SuspensionFields>(TABLES.suspensions, {});
}

describe("setSuspended", () => {
  it("suspending creates a linked Suspension recording who, when, and the member's name", async () => {
    resetMockStore({ [TABLES.members]: [{ id: MEMBER, fields: MEMBER_FIELDS }] });

    const status = await setSuspended(MEMBER, true, STAFF);
    assert.equal(status.suspended, true);
    const [s] = await suspensions();
    assert.deepEqual(s.fields, {
      "First Name": "Test",
      "Last Name": "Student",
      Member: [MEMBER],
      "Suspended By": [STAFF],
      "Suspended On": today(),
    });
  });

  it("suspending an already-suspended member adds nothing", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: MEMBER, fields: MEMBER_FIELDS }],
      [TABLES.suspensions]: [{ id: "recSusp1", fields: { Member: [MEMBER], "Suspended On": "2026-10-01" } }],
    });

    await setSuspended(MEMBER, true, STAFF);
    assert.equal((await suspensions()).length, 1);
  });

  it("unsuspending lifts every unlifted Suspension, keeping the rows", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: MEMBER, fields: MEMBER_FIELDS }],
      [TABLES.suspensions]: [
        { id: "recOld", fields: { Member: [MEMBER], "Suspended On": "2025-01-01", "Lifted On": "2025-02-01" } },
        { id: "recCurrent", fields: { Member: [MEMBER], "Suspended On": "2026-10-01" } },
      ],
    });

    const status = await setSuspended(MEMBER, false, STAFF);
    assert.equal(status.suspended, false);
    const byId = new Map((await suspensions()).map((s) => [s.id, s.fields]));
    assert.equal(byId.get("recOld")?.["Lifted On"], "2025-02-01");
    assert.deepEqual(byId.get("recCurrent")?.["Lifted By"], [STAFF]);
    assert.equal(byId.get("recCurrent")?.["Lifted On"], today());
  });

  it("rejects an unknown student", async () => {
    resetMockStore({});
    await assert.rejects(setSuspended("recNope", true, STAFF), NotFoundError);
  });
});
