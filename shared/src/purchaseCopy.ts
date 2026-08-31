// Pricing/policy copy shown next to a purchase — shared between the kiosk purchase
// flow (web/src/components/KioskPurchaseFlow.tsx) and the public sign-up widget
// (web-student/signup.html) so this wording can't drift between the two surfaces the
// way it used to (the kiosk didn't show any of this at all until it started importing
// from here).

// Surfaced next to every disclaimer below so no one is turned away by an unaffordable
// price without knowing they can ask for a lower one.
export const PRICING_CONTACT_EMAIL = "oz@oaktownzouk.com";

// The trailing "ask about a lower price" clause, right before the email address.
// Split out from the disclaimers below because it's the one piece that legitimately
// differs by surface: the public widget is used remotely (a phone, the studio's own
// site), where emailing is the only option; the kiosk is used in person at the
// studio, where asking the front desk directly is faster and more natural.
export const PRICING_CONTACT_CLAUSE = "Contact us at";
export const KIOSK_PRICING_CONTACT_CLAUSE = "Ask the front desk or email us at";

export const DROPIN_SLIDING_SCALE_DISCLAIMER =
  "Oaktown Zouk classes are priced on a sliding scale. No one turned away for lack of funds; need a lower priced ticket?";

// The kiosk's "Buy a pass or membership" flow doesn't distinguish new vs. returning
// members the way the public widget's separate first-time flow does (that flow also
// promises a 50%-off first month with refund instructions — see
// NEW_MEMBER_MEMBERSHIP_SLIDING_SCALE_DISCLAIMER below) — this is the general version
// both surfaces use for a membership purchase outside that first-time perk.
export const MEMBERSHIP_SLIDING_SCALE_DISCLAIMER =
  "Memberships are sliding scale, billed monthly. Each payment covers the next 30 calendar days of classes. Cancel any time from the Givebutter confirmation email. No one turned away for lack of funds. Need a lower priced membership?";

// Only shown on the public widget's first-time-member membership steps — the kiosk
// has no equivalent first-time-perk path today.
export const NEW_MEMBER_MEMBERSHIP_SLIDING_SCALE_DISCLAIMER =
  "Memberships are sliding scale, billed monthly. After you pay for your first month, you'll receive an email with instructions to get 50% refunded. Each payment covers the next 30 calendar days of classes. Cancel any time from the Givebutter confirmation email. No one turned away for lack of funds. Need a lower priced membership?";

// A first-timer's "second class" step: their first class is free, and the second is
// charged as one ordinary drop-in — both surfaces use this exact note together with
// that same drop-in product (DROPIN_PRODUCTS[1] in web/src/kioskProducts.ts), so the
// two must stay in sync.
export const FIRST_DAY_SECOND_CLASS_NOTE = "Your first class is free, your second class is $30-$40 sliding scale.";

// Shown once, before a first-timer's free class is booked — both surfaces render
// this as one sentence with two inline links (`prefix` … codeOfConduct.label … `and
// our` … liabilityWaiver.label), so it's structured as data rather than one plain
// string.
export const WAIVER_NOTICE = {
  prefix: "By attending classes, events, and/or dance socials at The Oakland Grove you agree to our",
  codeOfConduct: { label: "Code of Conduct", url: "https://www.theoaklandgrove.com/about#code-of-conduct" },
  connector: "and our",
  liabilityWaiver: { label: "Waiver of Liability", url: "https://www.theoaklandgrove.com/about#liability-waiver" },
};
