import { toText } from "./text.js";

export interface NameSource {
  first_name?: unknown;
  last_name?: unknown;
  contact?: { first_name?: unknown; last_name?: unknown; name?: unknown };
  name?: unknown;
}

// Prefers real first/last fields. Falls back to splitting a combined name on
// the LAST space -- a heuristic that gets "Maria Delgado" right and "Ana van
// der Berg" wrong (returns "Ana van der" / "Berg"). The plans sync corrects
// any donor who later becomes a member, since /plans returns proper
// first_name / last_name.
export function nameParts(source: NameSource): { first: string; last: string } {
  const first = toText(source.first_name ?? source.contact?.first_name);
  const last = toText(source.last_name ?? source.contact?.last_name);
  if (first || last) return { first, last };

  const fullName = toText(source.contact?.name ?? source.name);
  if (!fullName) return { first: "", last: "" };
  const nameSegments = fullName.split(/\s+/);
  return nameSegments.length === 1
    ? { first: fullName, last: "" }
    : { first: nameSegments.slice(0, -1).join(" "), last: nameSegments[nameSegments.length - 1] };
}

export function tagList(tags: unknown): string {
  if (!tags) return "";
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => (typeof tag === "string" ? tag : toText((tag as { name?: unknown; label?: unknown } | null)?.name ?? (tag as { name?: unknown; label?: unknown } | null)?.label)))
      .filter(Boolean)
      .join(", ");
  }
  return toText(tags);
}

export interface AddressSource {
  address_1?: unknown;
  address_2?: unknown;
  city?: unknown;
  state?: unknown;
  zipcode?: unknown;
  zip?: unknown;
  country?: unknown;
}

export function flattenAddress(address: AddressSource | null | undefined): string {
  if (!address) return "";
  return [
    [address.address_1, address.address_2].filter(Boolean).join(" "),
    [address.city, address.state].filter(Boolean).join(", "),
    [address.zipcode ?? address.zip, address.country].filter(Boolean).join(" "),
  ]
    .map((s) => toText(s))
    .filter(Boolean)
    .join("\n");
}
