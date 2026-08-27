// Evaluates the `filterByFormula` strings this app actually sends to Airtable.
// Deliberately not a general Airtable-formula parser — every formula in this codebase
// is built from our own template strings, so there's a small, closed set of shapes to
// support. Anything outside that set throws loudly rather than silently mis-filtering,
// so a new formula shape added later fails a test immediately instead of quietly
// returning wrong data.

export interface MockRecordLike {
  id: string;
  fields: Record<string, unknown>;
}

export function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

// Splits "a, b(c, d), e" into ["a", "b(c, d)", "e"] — respects paren nesting so a
// nested call's own commas (e.g. inside DATETIME_FORMAT) don't get treated as AND's
// own argument separators.
function splitTopLevelArgs(s: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      args.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(s.slice(start).trim());
  return args;
}

export function evaluateFormula(formula: string, record: MockRecordLike): boolean {
  const expr = formula.trim();

  const notMatch = expr.match(/^NOT\((.*)\)$/s);
  if (notMatch) return !evaluateFormula(notMatch[1], record);

  const andMatch = expr.match(/^AND\((.*)\)$/s);
  if (andMatch) return splitTopLevelArgs(andMatch[1]).every((arg) => evaluateFormula(arg, record));

  const orMatch = expr.match(/^OR\((.*)\)$/s);
  if (orMatch) return splitTopLevelArgs(orMatch[1]).some((arg) => evaluateFormula(arg, record));

  let m = expr.match(/^\{([^}]+)\}\s*=\s*BLANK\(\)$/);
  if (m) return isBlank(record.fields[m[1]]);

  // Bare {Field} used as a boolean truthiness check (e.g. NOT({Duplicate})).
  m = expr.match(/^\{([^}]+)\}$/);
  if (m) return Boolean(record.fields[m[1]]);

  m = expr.match(/^LOWER\(\{([^}]+)\}\)\s*=\s*LOWER\('([^']*)'\)$/);
  if (m) return String(record.fields[m[1]] ?? "").toLowerCase() === m[2].toLowerCase();

  m = expr.match(/^LOWER\(\{([^}]+)\}\)\s*=\s*'([^']*)'$/);
  if (m) return String(record.fields[m[1]] ?? "").toLowerCase() === m[2].toLowerCase();

  m = expr.match(/^\{([^}]+)\}\s*=\s*'([^']*)'$/);
  if (m) return String(record.fields[m[1]] ?? "") === m[2];

  m = expr.match(/^\{([^}]+)\}\s*=\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return Number(record.fields[m[1]] ?? 0) === Number(m[2]);

  m = expr.match(/^DATETIME_FORMAT\(SET_TIMEZONE\(\{([^}]+)\},\s*'([^']*)'\),\s*'YYYY-MM-DD'\)\s*=\s*'([^']*)'$/);
  if (m) {
    const [, field, tz, dateStr] = m;
    const raw = record.fields[field];
    if (isBlank(raw)) return false;
    const asDate = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(raw as string));
    return asDate === dateStr;
  }

  throw new Error(`mockFormula: unsupported formula shape: ${formula}`);
}
