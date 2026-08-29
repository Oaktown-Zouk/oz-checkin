// Givebutter's widget-loader script (defines the <givebutter-widget> custom element
// — see useGivebutterWidgetScript.ts) — account-specific. Given by the studio
// directly, not discoverable from anything else in this repo. `acct` is Givebutter's
// own public account hash, not the plain numeric account id (confirmed against the
// real widget: a bare numeric id gets rejected at runtime with "Invalid ?acct=
// format").
export const GIVEBUTTER_WIDGET_SCRIPT_SRC = "https://widgets.givebutter.com/latest.umd.cjs?acct=K2zE8rPXlwbTczim&p=other";

export interface GivebutterProduct {
  key: "signup" | "dropin-1" | "dropin-2" | "membership-1" | "membership-2";
  widgetId: string;
  // The hosted Givebutter page for this same product — undefined for signup, which
  // skips the "scan to buy on your phone" step entirely and goes straight to the
  // embedded widget (see KioskPurchaseFlow.tsx).
  qrUrl?: string;
}

export const SIGNUP_PRODUCT: GivebutterProduct = { key: "signup", widgetId: "gOKNYY" };
export const DROPIN_PRODUCTS: Record<1 | 2, GivebutterProduct> = {
  1: { key: "dropin-1", widgetId: "LqbDvk", qrUrl: "https://givebutter.com/oaktown-zouk-dropin" },
  2: { key: "dropin-2", widgetId: "jNKM3W", qrUrl: "https://givebutter.com/oaktown-zouk-2-class-dropin" },
};
export const MEMBERSHIP_PRODUCTS: Record<1 | 2, GivebutterProduct> = {
  1: { key: "membership-1", widgetId: "p71z32", qrUrl: "https://givebutter.com/oaktown-zouk-membership" },
  2: { key: "membership-2", widgetId: "pnVx7r", qrUrl: "https://givebutter.com/oaktown-zouk-2-class-membership" },
};

// The kiosk's sign-up/purchase flow, layered on top of the ordinary "home" screen
// (search bar + check-in) — see KioskPage.tsx/KioskPurchaseFlow.tsx.
export type KioskFlowScreen =
  | { kind: "signup" }
  | { kind: "buyAPass" }
  | { kind: "dropInCount" }
  | { kind: "membershipCount" }
  | { kind: "qr"; product: GivebutterProduct }
  | { kind: "widget"; product: GivebutterProduct };

export type KioskScreen = { kind: "home" } | KioskFlowScreen;
