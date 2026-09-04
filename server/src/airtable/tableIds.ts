// Table IDs, not names — stable against the user renaming a table in the Airtable UI
// (already happened once with fields during this project; names are for humans only).
// Split out from client.ts so both the real and mock clients can reference table ids
// without a circular import through the client dispatcher.
export const TABLES = {
  members: "tbl90E8ZFxXlZrVkn",
  checkins: "tblUN06HQtcMIucxK",
  recurringPlans: "tblRJAL7UjNf9N0WB",
  transactions: "tbl97hoFODKY50QcH",
  // TODO: replace once the "Comp Credits" table exists in Airtable (Step 0 of
  // docs/airtable-schema.md's Credits section) -- ask Claude to look it up via the
  // metadata API once it's created, rather than typing it in by hand.
  compCredits: "REPLACE_WITH_COMP_CREDITS_TABLE_ID",
  programs: "tblB90zwd3OjKxxDs",
  userRoles: "tblBeLbVbHNZIPIvz",
  rolePermissions: "tblYo1awEOvqBGVpR",
  levelups: "tblSFmkH7KlWVRmfM",
  notes: "tblXfNHoBzKa3mqpB",
} as const;
