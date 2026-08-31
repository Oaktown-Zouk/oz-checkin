import {
  DROPIN_SLIDING_SCALE_DISCLAIMER,
  FIRST_DAY_SECOND_CLASS_NOTE,
  MEMBERSHIP_SLIDING_SCALE_DISCLAIMER,
  NEW_MEMBER_MEMBERSHIP_SLIDING_SCALE_DISCLAIMER,
  PRICING_CONTACT_CLAUSE,
  PRICING_CONTACT_EMAIL,
  WAIVER_NOTICE,
} from "shared";
import "./signup.css";

// The public sign-up/purchase widget's step-show logic — see signup.html for why
// this is plain TS/DOM rather than React. Steps are toggled by `hidden` rather than
// mounted/unmounted, same approach the kiosk's own React flow uses (see
// KioskCheckInDialog.tsx's comment on why picks are purely local until submit) —
// simple enough here that no framework is needed to keep it correct.

const DISCLAIMERS: Record<string, string> = {
  dropin: DROPIN_SLIDING_SCALE_DISCLAIMER,
  membership: MEMBERSHIP_SLIDING_SCALE_DISCLAIMER,
  "new-member-membership": NEW_MEMBER_MEMBERSHIP_SLIDING_SCALE_DISCLAIMER,
};

function emailLink(): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = `mailto:${PRICING_CONTACT_EMAIL}`;
  link.textContent = PRICING_CONTACT_EMAIL;
  return link;
}

const container = document.getElementById("guided-form-widget")!;
const steps = container.querySelectorAll<HTMLElement>(".gfw-step");

// Fills in the shared copy once, up front, rather than re-rendering it on every step
// change — it's all static per placeholder, so there's nothing to update after this.

container.querySelectorAll<HTMLElement>("[data-disclaimer]").forEach((el) => {
  const text = DISCLAIMERS[el.dataset.disclaimer!];
  if (!text) return;
  el.textContent = `${text} ${PRICING_CONTACT_CLAUSE} `;
  el.appendChild(emailLink());
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
