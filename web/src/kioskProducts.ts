export interface GivebutterProduct {
  key: "signup" | "dropin-1" | "dropin-2" | "membership-1" | "membership-2";
  widgetId: string;
}

export const SIGNUP_PRODUCT: GivebutterProduct = { key: "signup", widgetId: "gOKNYY" };
// The studio's own public sign-up/purchase page (web-student/signup.html, its own
// Vite entry on the student Netlify site — see that file) — offered as a QR code on
// the "buy a pass" screen so a student can finish on their own phone instead of the
// tablet, covering every product from one code (picking drop-in vs. membership, and
// class count, happens on the page it lands on) — so once a class count is picked on
// the tablet itself, the flow goes straight to that product's embedded widget with no
// second, product-specific QR step. Points straight at the canonical hosted page
// rather than its oaktownzouk.com/sign-up (Google Sites) or theoaklandgrove.com/zouk
// (Squarespace) iframe embeds — no reason to route the kiosk's own QR code through
// either wrapper.
export const KIOSK_SIGNUP_PAGE_URL = "https://my.oaktownzouk.com/signup";
export const DROPIN_PRODUCTS: Record<1 | 2, GivebutterProduct> = {
  1: { key: "dropin-1", widgetId: "LqbDvk" },
  2: { key: "dropin-2", widgetId: "jNKM3W" },
};
export const MEMBERSHIP_PRODUCTS: Record<1 | 2, GivebutterProduct> = {
  1: { key: "membership-1", widgetId: "p71z32" },
  2: { key: "membership-2", widgetId: "pnVx7r" },
};

// The kiosk's sign-up/purchase flow, layered on top of the ordinary "home" screen
// (search bar + check-in) — see KioskPage.tsx/KioskPurchaseFlow.tsx. The first-timer
// branch (signupCount/signupWaiver/signupFreeClass/signupSecondClass) mirrors the
// public widget's own first-time flow (see web-student/signup.html) rather than
// going straight to a free-class form: a first-timer who actually wants to attend
// two classes needs to pay for the second one regardless, and it's faster to buy it
// now than to fill out the free-class contact form and come back to buy separately.
export type KioskFlowScreen =
  | { kind: "signupCount" }
  | { kind: "signupWaiver" }
  | { kind: "signupFreeClass" }
  | { kind: "signupSecondClass" }
  | { kind: "buyAPass" }
  | { kind: "dropInCount" }
  | { kind: "membershipCount" }
  | { kind: "widget"; product: GivebutterProduct };

export type KioskScreen = { kind: "home" } | KioskFlowScreen;
