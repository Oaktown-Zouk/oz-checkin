import { normalizeSelectText } from "./text.js";

export interface SelectChoice {
  id: string;
  name: string;
}

// Case-sensitive, exact-match against existing choice names. Airtable
// rejects a select write for any value not already in the choice list, so
// this is what decides whether a sync run needs to widen the field first.
export function missingSelectChoiceNames(existingChoices: SelectChoice[], incomingValues: unknown[]): string[] {
  const existingNames = new Set(existingChoices.map((choice) => choice.name));
  const missing = new Set<string>();
  for (const value of incomingValues) {
    const text = normalizeSelectText(value);
    if (text && !existingNames.has(text)) missing.add(text);
  }
  return [...missing];
}
