// Table IDs, not names — stable against the user renaming a table in the Airtable UI
// (already happened once with fields during this project; names are for humans only).
// Split out from client.ts so both the real and mock clients can reference table ids
// without a circular import through the client dispatcher.
export const TABLES = {
  members: "tbl90E8ZFxXlZrVkn",
  checkins: "tblUN06HQtcMIucxK",
  recurringPlans: "tblRJAL7UjNf9N0WB",
  transactions: "tbl97hoFODKY50QcH",
  credits: "tblCFmQJntHiuMZNN",
  programs: "tblB90zwd3OjKxxDs",
  userRoles: "tblBeLbVbHNZIPIvz",
  rolePermissions: "tblYo1awEOvqBGVpR",
  levelups: "tblSFmkH7KlWVRmfM",
  notes: "tblXfNHoBzKa3mqpB",
} as const;
