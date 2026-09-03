// buildRecurringPlanFields/buildTransactionFields (planFields.ts,
// transactionFields.ts) produce the Scripting SDK's cell-value shape for a
// single select -- {name: "..."} -- which is correct for the nightly scripts'
// table.createRecordsAsync()/updateRecordsAsync() calls, but wrong for a raw
// REST API write: Airtable's REST API wants a select field as a plain
// string, and rejects the Scripting-shaped object with "Cannot parse value
// for field X" even when the value is a real, existing choice (confirmed via
// the base's own field metadata during the 2026-09-03 webhook incident -- see
// docs/airtable-automations/README.md). This adapts a fields object built for
// the Scripting SDK into REST-safe form right before a REST write, without
// changing what the shared builders themselves produce -- they stay correct
// for the nightly scripts, which never touch this function.
export function toRestFields(fields: Record<string, unknown>): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    converted[key] = isSelectCellValue(value) ? value.name : value;
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
