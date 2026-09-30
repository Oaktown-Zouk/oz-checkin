import {
  DROPIN_SLIDING_SCALE_POLICY_NOTE,
  FINANCIAL_NEED_LINKS,
  FIRST_DAY_SECOND_CLASS_NOTE,
  MEMBERSHIP_SLIDING_SCALE_POLICY_NOTE,
  NEW_MEMBER_MEMBERSHIP_SLIDING_SCALE_POLICY_NOTE,
  WAIVER_NOTICE,
} from "shared";
import "./signup.css";

// The public sign-up/purchase widget's step-show logic — see signup.html for why
// this is plain TS/DOM rather than React. Steps are toggled by `hidden` rather than
// mounted/unmounted, same approach the kiosk's own React flow uses (see
// KioskCheckInDialog.tsx's comment on why picks are purely local until submit) —
// simple enough here that no framework is needed to keep it correct.

const POLICY_NOTES: Record<string, string> = {
  dropin: DROPIN_SLIDING_SCALE_POLICY_NOTE,
  membership: MEMBERSHIP_SLIDING_SCALE_POLICY_NOTE,
  "new-member-membership": NEW_MEMBER_MEMBERSHIP_SLIDING_SCALE_POLICY_NOTE,
};

// Which FINANCIAL_NEED_LINKS campaign goes with each policy note above —
// "new-member-membership" shares the general membership campaign, since there's
// only the one Givebutter page for financial-need memberships.
const FINANCIAL_NEED_CATEGORY: Record<string, keyof typeof FINANCIAL_NEED_LINKS> = {
  dropin: "dropin",
  membership: "membership",
  "new-member-membership": "membership",
};

// Givebutter's checkout defaults to a 15% tip to Givebutter itself, separate from
// (and not covered by) anything on this page's own sliding-scale notes above — worth
// calling out on every step that actually charges a card, since it's easy to miss
// inside the embedded widget and just as easy to change once you know it's there.
const TIP_NOTE =
  "Our payment processor, Givebutter, sets a default 15% tip that goes to them. You can set this to any other amount, including 0.";

// Which site embedded this page, passed as ?theme= on the iframe's own src — see
// signup.css's :root[data-theme=...] blocks for the actual palette each one maps to.
// Unknown/missing values fall through to the default (oaktownzouk.com's own look)
// rather than erroring, since a stray or outdated query param shouldn't break the
// page.
const KNOWN_THEMES = new Set(["oaklandgrove"]);
const requestedTheme = new URLSearchParams(location.search).get("theme");
if (requestedTheme && KNOWN_THEMES.has(requestedTheme)) {
  document.documentElement.dataset.theme = requestedTheme;
}

function financialNeedLink(category: keyof typeof FINANCIAL_NEED_LINKS): HTMLAnchorElement {
  const { url } = FINANCIAL_NEED_LINKS[category];
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = "here";
  return link;
}

const container = document.getElementById("guided-form-widget")!;
const steps = container.querySelectorAll<HTMLElement>(".gfw-step");

// Fills in the shared copy once, up front, rather than re-rendering it on every step
// change — it's all static per placeholder, so there's nothing to update after this.

container.querySelectorAll<HTMLElement>("[data-policy-note]").forEach((el) => {
  const key = el.dataset.policyNote!;
  const text = POLICY_NOTES[key];
  if (!text) return;
  const category = FINANCIAL_NEED_CATEGORY[key];
  el.textContent = `${text} Click `;
  el.appendChild(financialNeedLink(category));
  el.append(` for ${FINANCIAL_NEED_LINKS[category].label}.`);
});

container.querySelectorAll<HTMLElement>("[data-tip-note]").forEach((el) => {
  el.textContent = TIP_NOTE;
});

const waiverEl = container.querySelector<HTMLElement>("[data-waiver]");
if (waiverEl) {
  waiverEl.textContent = `${WAIVER_NOTICE.prefix} `;
  const codeOfConductLink = document.createElement("a");
  codeOfConductLink.href = WAIVER_NOTICE.codeOfConduct.url;
  codeOfConductLink.target = "_blank";
  codeOfConductLink.rel = "noopener";
  codeOfConductLink.textContent = WAIVER_NOTICE.codeOfConduct.label;
  waiverEl.appendChild(codeOfConductLink);
  waiverEl.append(` ${WAIVER_NOTICE.connector} `);
  const liabilityLink = document.createElement("a");
  liabilityLink.href = WAIVER_NOTICE.liabilityWaiver.url;
  liabilityLink.target = "_blank";
  liabilityLink.rel = "noopener";
  liabilityLink.textContent = WAIVER_NOTICE.liabilityWaiver.label;
  waiverEl.appendChild(liabilityLink);
}

const secondClassEl = container.querySelector<HTMLElement>("[data-first-day-second-class]");
if (secondClassEl) secondClassEl.textContent = FIRST_DAY_SECOND_CLASS_NOTE;

function showStep(stepName: string) {
  steps.forEach((step) => {
    step.hidden = step.dataset.step !== stepName;
  });
  if (container.getBoundingClientRect().top < 0) {
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

container.addEventListener("click", (e) => {
  const target = (e.target as HTMLElement).closest<HTMLElement>("[data-goto]");
  if (target) showStep(target.dataset.goto!);
});
