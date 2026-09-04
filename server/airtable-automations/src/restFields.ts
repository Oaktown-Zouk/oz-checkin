// The field-builders (planFields.ts, transactionFields.ts, and every call
// site in the webhook body that sets a link field directly, e.g.
// `fields['Member'] = [{ id: memberRecordId }]`) produce the Scripting SDK's
// cell-value shapes -- correct for the nightly scripts' own
// table.createRecordsAsync()/updateRecordsAsync() calls, but wrong for a raw
// REST API write. Two shapes differ, both confirmed against real 422s during
// the 2026-09-03 webhook incident (see docs/airtable-automations/CHANGELOG.md):
//   - single select: SDK wants {name: "..."}; REST wants a plain string, and
//     rejects the object with "Cannot parse value for field X" even for a
//     real, existing choice.
//   - linked record: SDK wants [{id: "recXXX"}]; REST wants a plain array of
//     id strings (["recXXX"]), and rejects the object form with
//     "INVALID_RECORD_ID" / `Value "[object Object]" is not a valid record
//     ID.` -- the object stringifies to that when REST tries to parse it as
//     an id.
// This adapts a fields object built for the Scripting SDK into REST-safe form
// right before a REST write, without changing what the shared builders
// themselves produce -- they stay correct for the nightly scripts, which
// never touch this function.
export function toRestFields(fields: Record<string, unknown>): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isSelectCellValue(value)) {
      converted[key] = value.name;
    } else if (isLinkCellArray(value)) {
      converted[key] = value.map((link) => link.id);
    } else {
      converted[key] = value;
    }
  }
  return converted;
}

function isSelectCellValue(value: unknown): value is { name: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "name" in value &&
    Object.keys(value).length === 1
  );
}

function isLinkCellArray(value: unknown): value is Array<{ id: string }> {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "object" && item !== null && typeof (item as { id?: unknown }).id === "string")
  );
}
