import { toText } from "./text.js";

// Givebutter merges duplicate contacts by deleting the losing contact outright:
// it vanishes from /contacts and GET /contacts/{id} 404s, with no pointer to the
// contact it was merged into. These functions find Members whose contact has
// vanished and, where an email identifies exactly one live contact, the Member
// that contact belongs to.

export interface MergeCheckMember {
  id: string;
  contactId: string;
  email: string;
  removedFromGivebutter: boolean;
  hasDuplicateOf: boolean;
}

export interface MergeCheckContact {
  id?: unknown;
  primary_email?: unknown;
  emails?: { value?: unknown }[] | null;
}

// Every address a contact is reachable at, lowercased and de-duplicated.
export function contactEmails(contact: MergeCheckContact): string[] {
  const all = [contact.primary_email, ...(contact.emails ?? []).map((e) => e?.value)]
    .map((e) => toText(e).toLowerCase())
    .filter(Boolean);
  return [...new Set(all)];
}

// email → ids of every live contact carrying that email.
export function indexContactIdsByEmail(contacts: MergeCheckContact[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const contact of contacts) {
    const contactId = toText(contact.id);
    if (!contactId) continue;
    for (const email of contactEmails(contact)) {
      index.set(email, [...(index.get(email) ?? []), contactId]);
    }
  }
  return index;
}

export interface VanishedSplit {
  // Contact ID missing from the live pull, not yet flagged.
  newlyVanished: MergeCheckMember[];
  // Flagged earlier but the contact is live again, and nobody has resolved
  // Duplicate Of yet -- the flag can come back off.
  reappeared: MergeCheckMember[];
}

export function splitVanishedMembers(members: MergeCheckMember[], liveContactIds: Set<string>): VanishedSplit {
  const newlyVanished: MergeCheckMember[] = [];
  const reappeared: MergeCheckMember[] = [];
  for (const member of members) {
    if (!member.contactId) continue;
    const live = liveContactIds.has(member.contactId);
    if (!live && !member.removedFromGivebutter) newlyVanished.push(member);
    if (live && member.removedFromGivebutter && !member.hasDuplicateOf) reappeared.push(member);
  }
  return { newlyVanished, reappeared };
}

// The Member a vanished Member was most likely merged into: the one whose
// contact is the ONLY live contact carrying the vanished Member's email.
// Returns null when there's no email, no match, several matches, or the match
// is the vanished Member itself -- all of which are left for manual review.
export function survivorMemberId(
  vanished: MergeCheckMember,
  contactIdsByEmail: Map<string, string[]>,
  memberIdByContactId: Map<string, string>
): string | null {
  const email = toText(vanished.email).toLowerCase();
  if (!email) return null;
  const contactIds = contactIdsByEmail.get(email) ?? [];
  if (contactIds.length !== 1) return null;
  const memberId = memberIdByContactId.get(contactIds[0]);
  if (!memberId || memberId === vanished.id) return null;
  return memberId;
}
