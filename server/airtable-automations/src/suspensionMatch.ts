// Matching a Suspension (a person, who may never have had a Member record) against
// Members by name, for match-suspensions.js. Name alone decides it — staff often
// know only a name, and a different email mustn't get a suspended person in.

// Case, accents, punctuation, and spacing are all ignored: "José O'Brien" and
// "jose obrien" are the same name.
export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SuspensionPerson {
  firstName: unknown;
  lastName: unknown;
  otherNames: unknown; // one "First Last" per line
}

export interface MemberPerson {
  firstName: unknown;
  lastName: unknown;
}

// Every full name this suspension goes by, normalized. A blank first or last name
// on the main name drops it (a bare surname would match far too widely).
export function suspensionNames(s: SuspensionPerson): Set<string> {
  const names = new Set<string>();
  const first = normalizeName(s.firstName);
  const last = normalizeName(s.lastName);
  if (first && last) names.add(`${first} ${last}`);
  for (const line of String(s.otherNames ?? "").split("\n")) {
    const name = normalizeName(line);
    if (name.includes(" ")) names.add(name);
  }
  return names;
}

export function matchesSuspension(s: SuspensionPerson, m: MemberPerson): boolean {
  const first = normalizeName(m.firstName);
  const last = normalizeName(m.lastName);
  return !!first && !!last && suspensionNames(s).has(`${first} ${last}`);
}
