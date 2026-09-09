import { toText, toBoolean, toDateOnly } from "./text.js";
import { tagList, flattenAddress, type AddressSource } from "./givebutterParsing.js";

// Fields for a brand-new Member row created from a /plans or /transactions
// payload. NOT lowercased -- matches the nightly Plans and Transactions
// scripts' existing behavior. (The nightly Contacts script and the webhook
// script both DO lowercase email on create -- see
// buildNewMemberFieldsWithLowercaseEmail and buildContactMemberFields below.
// That inconsistency predates this refactor and isn't fixed here, since
// unifying it would change what four different scripts actually write.)
export function buildNewMemberFields(first: unknown, last: unknown, email: unknown, phone: unknown): Record<string, string> {
  return {
    "First Name": toText(first),
    "Last Name": toText(last),
    "Email": toText(email),
    "Phone": toText(phone),
  };
}

export function buildNewMemberFieldsWithLowercaseEmail(
  first: unknown,
  last: unknown,
  email: unknown,
  phone: unknown
): Record<string, string> {
  return {
    "First Name": toText(first),
    "Last Name": toText(last),
    "Email": toText(email).toLowerCase(),
    "Phone": toText(phone),
  };
}

export interface PartialMemberInfo {
  first?: string;
  last?: string;
  email?: string;
  phone?: string;
}

const FIELD_NAME_BY_KEY: Record<keyof PartialMemberInfo, string> = {
  first: "First Name",
  last: "Last Name",
  email: "Email",
  phone: "Phone",
};

// Fills a currently-blank field on an existing Member from a fresh value --
// never overwrites something already there. Only considers whichever keys
// the caller actually passes in `incoming`: the nightly Transactions script
// omits `phone` here (even though it captures a phone number for the
// brand-new-member case above), so a transaction never fills a phone gap --
// that's existing, if surprising, behavior, not something this function
// decides on its own.
export function fillMemberFieldGaps(incoming: PartialMemberInfo, current: PartialMemberInfo): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const key of Object.keys(incoming) as (keyof PartialMemberInfo)[]) {
    const value = incoming[key];
    if (value && !current[key]) {
      changed[FIELD_NAME_BY_KEY[key]] = value;
    }
  }
  return changed;
}

// Overwrites a field only when the incoming value actually differs from
// what's there now -- used by the nightly Plans script to avoid churning
// every member's "last modified" timestamp on every run.
export function diffMemberFields(incoming: PartialMemberInfo, current: PartialMemberInfo): Record<string, string> {
  const changed: Record<string, string> = {};
  for (const key of Object.keys(incoming) as (keyof PartialMemberInfo)[]) {
    const value = incoming[key];
    if (value && value !== current[key]) {
      changed[FIELD_NAME_BY_KEY[key]] = value;
    }
  }
  return changed;
}

export interface GivebutterContactPayload {
  id?: unknown;
  first_name?: unknown;
  preferred_name?: unknown;
  last_name?: unknown;
  primary_email?: unknown;
  emails?: Array<{ value?: unknown }>;
  primary_phone?: unknown;
  phones?: Array<{ value?: unknown }>;
  tags?: unknown;
  is_email_subscribed?: unknown;
  email_opt_in?: unknown;
  is_phone_subscribed?: unknown;
  sms_opt_in?: unknown;
  contact_since?: unknown;
  created_at?: unknown;
  stats?: { total_contributions?: unknown };
  primary_address?: AddressSource;
  addresses?: AddressSource[];
  note?: unknown;
  archived_at?: unknown;
}

// The nightly Contacts script's field set -- always written unconditionally
// (Givebutter is authoritative for all of these), unlike the gap-fill/diff
// functions above.
export function buildContactMemberFields(contact: GivebutterContactPayload, contactSyncedAt: string): Record<string, unknown> {
  return {
    "Contact ID": toText(contact.id),
    "First Name": toText(contact.first_name ?? contact.preferred_name),
    "Last Name": toText(contact.last_name),
    "Email": toText(contact.primary_email ?? contact.emails?.[0]?.value).toLowerCase(),
    "Phone": toText(contact.primary_phone ?? contact.phones?.[0]?.value),
    "Tags": tagList(contact.tags),
    "Email Subscribed": toBoolean(contact.is_email_subscribed ?? contact.email_opt_in),
    "Phone Subscribed": toBoolean(contact.is_phone_subscribed ?? contact.sms_opt_in),
    "Contact Since": toDateOnly(contact.contact_since ?? contact.created_at),
    "Givebutter Total Given": Number(contact.stats?.total_contributions) || 0,
    "Address": flattenAddress(contact.primary_address ?? contact.addresses?.[0]),
    "Givebutter Note": toText(contact.note),
    "Archived in Givebutter": Boolean(contact.archived_at),
    "Contact Synced At": contactSyncedAt,
  };
}
