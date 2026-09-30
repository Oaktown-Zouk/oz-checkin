// Pricing/policy copy shown next to a purchase — shared between the kiosk purchase
// flow (web/src/components/KioskPurchaseFlow.tsx) and the public sign-up widget
// (web-student/signup.html) so this wording can't drift between the two surfaces the
// way it used to (the kiosk didn't show any of this at all until it started importing
// from here).

// Givebutter campaign pages offering financial-need pricing, surfaced next to every
// policy note below so no one is turned away by an unaffordable price without
// knowing there's a lower-priced option. Replaces the old "contact us"/"ask the
// front desk" email clause now that these self-serve campaigns exist. Keyed by
// product type since each campaign is its own Givebutter page; "membership" covers
// both the general and first-time-member membership policy notes below, which share
// the one campaign.
export const FINANCIAL_NEED_LINKS: Record<"dropin" | "membership", { url: string; label: string }> = {
  dropin: { url: "https://givebutter.com/oaktown-zouk-notaflof-dropins", label: "financial need drop-in pricing" },
  membership: {
    url: "https://givebutter.com/oaktown-zouk-financial-need-7f4mlw",
    label: "financial need membership pricing",
  },
};

export const DROPIN_SLIDING_SCALE_POLICY_NOTE =
  "Oaktown Zouk classes are priced on a sliding scale. No one turned away for lack of funds; need a lower priced ticket?";

// The kiosk's "Buy a pass or membership" flow doesn't distinguish new vs. returning
// members the way the public widget's separate first-time flow does (that flow also
// promises a 50%-off first month with refund instructions — see
// NEW_MEMBER_MEMBERSHIP_SLIDING_SCALE_POLICY_NOTE below) — this is the general
// version both surfaces use for a membership purchase outside that first-time perk.
export const MEMBERSHIP_SLIDING_SCALE_POLICY_NOTE =
  "Memberships are sliding scale, billed monthly. Each payment covers the next 30 calendar days of classes. Cancel any time from the Givebutter confirmation email. No one turned away for lack of funds. Need a lower priced membership?";

// Only shown on the public widget's first-time-member membership steps — the kiosk
// has no equivalent first-time-perk path today.
export const NEW_MEMBER_MEMBERSHIP_SLIDING_SCALE_POLICY_NOTE =
  "Memberships are sliding scale, billed monthly. After you pay for your first month, you'll receive an email with instructions to get 50% refunded. Each payment covers the next 30 calendar days of classes. Cancel any time from the Givebutter confirmation email. No one turned away for lack of funds. Need a lower priced membership?";

// A first-timer's "second class" step: their first class is free, and the second is
// charged as one ordinary drop-in — both surfaces use this exact note together with
// that same drop-in product (DROPIN_PRODUCT in web/src/kioskProducts.ts), so the two
// must stay in sync.
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
