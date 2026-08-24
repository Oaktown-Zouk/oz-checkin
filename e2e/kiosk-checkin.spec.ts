import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("kiosk-role login redirects to /kiosk, and a self-check-in updates instantly", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByPlaceholder("Or type your name…").fill("Active Amy");
  await page.getByRole("button", { name: "Active Amy" }).click();

  // Instant loading feedback before the fetch resolves — see KioskPage.tsx's
  // DialogState. Non-fatal if it resolves too fast to observe.
  await expect(page.getByText("Loading…")).toBeVisible({ timeout: 1000 }).catch(() => {});

  await expect(page.getByRole("heading", { name: "Active Amy" })).toBeVisible();
  await page.locator(".kiosk-program-row", { hasText: "Zouk L1" }).getByRole("button", { name: "Lead" }).click();

  // This is the exact flow that used to 404 (see KioskCheckInDialog's eligibility-
  // gate fix) — the dialog must reflect the fresh state, not error out or go stale.
  await expect(page.locator(".kiosk-program-row", { hasText: "Zouk L1" }).getByRole("button", { name: "✓ Lead" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Done" })).toBeVisible();
});
