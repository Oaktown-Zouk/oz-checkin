import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { listRecords } from "../airtable/client.js";
import { TABLES } from "../airtable/tableIds.js";
import type { NoteFields } from "../airtable/fields.js";
import { createNote } from "./notes.js";
import { NotFoundError } from "../lib/errors.js";

describe("createNote", () => {
  it("creates a Notes record linked to the student and issuer", async () => {
    resetMockStore({
      [TABLES.members]: [{ id: "recMember1", fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
    });

    await createNote(
      "recMember1",
      { summary: "Great progress this week", strengths: "Strong frame", opportunities: "Timing on turns" },
      "recIssuer1"
    );

    const notes = await listRecords<NoteFields>(TABLES.notes);
    assert.equal(notes.length, 1);
    assert.deepEqual(notes[0].fields, {
      Member: ["recMember1"],
      Issuer: ["recIssuer1"],
      Summary: "Great progress this week",
      Strengths: "Strong frame",
      Opportunities: "Timing on turns",
    });
  });

  it("throws NotFoundError for an unknown student", async () => {
    resetMockStore({});
    await assert.rejects(
      () => createNote("recNope", { summary: "x", strengths: "", opportunities: "" }, "recIssuer1"),
      NotFoundError
    );
  });
});
