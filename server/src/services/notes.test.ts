import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resetMockStore } from "../airtable/mockClient.js";
import { listRecords } from "../airtable/client.js";
import { TABLES } from "../airtable/tableIds.js";
import type { NoteFields } from "../airtable/fields.js";
import { createNote, updateNote } from "./notes.js";
import { NotFoundError, ForbiddenError } from "../lib/errors.js";

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

describe("updateNote", () => {
  function seedNote() {
    resetMockStore({
      [TABLES.members]: [{ id: "recMember1", fields: { "Full Name": "Test Student", "Classes Allowed": 1 } }],
      [TABLES.notes]: [
        {
          id: "recNote1",
          fields: {
            Member: ["recMember1"],
            Issuer: ["recIssuer1"],
            Summary: "Original summary",
            Strengths: "Original strengths",
            Opportunities: "Original opportunities",
          },
        },
      ],
    });
  }

  it("updates the note's fields when the caller is the original issuer", async () => {
    seedNote();
    await updateNote(
      "recNote1",
      { summary: "Updated summary", strengths: "Updated strengths", opportunities: "Updated opportunities" },
      "recIssuer1"
    );

    const [note] = await listRecords<NoteFields>(TABLES.notes);
    assert.equal(note.fields.Summary, "Updated summary");
    assert.equal(note.fields.Strengths, "Updated strengths");
    assert.equal(note.fields.Opportunities, "Updated opportunities");
  });

  it("throws ForbiddenError when a different issuer tries to edit it", async () => {
    seedNote();
    await assert.rejects(
      () => updateNote("recNote1", { summary: "Hijacked", strengths: "", opportunities: "" }, "recSomeoneElse"),
      ForbiddenError
    );

    const [note] = await listRecords<NoteFields>(TABLES.notes);
    assert.equal(note.fields.Summary, "Original summary");
  });

  it("throws NotFoundError for an unknown note", async () => {
    resetMockStore({});
    await assert.rejects(
      () => updateNote("recNope", { summary: "x", strengths: "", opportunities: "" }, "recIssuer1"),
      NotFoundError
    );
  });
});
