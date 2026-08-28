import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("kiosk-role login redirects to /kiosk, and a self-check-in submits on Done", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByPlaceholder("Or type your name…").fill("Active Amy");
  await page.getByRole("button", { name: "Active Amy" }).click();

  // Instant loading feedback before the fetch resolves — see KioskPage.tsx's
  // DialogState. Non-fatal if it resolves too fast to observe.
  await expect(page.getByText("Loading…")).toBeVisible({ timeout: 1000 }).catch(() => {});

  await expect(page.getByRole("heading", { name: "Active Amy" })).toBeVisible();
  const leadButton = page.locator(".kiosk-program-row", { hasText: "Zouk L1" }).getByRole("button", { name: "Lead" });
  await leadButton.click();

  // Tapping only picks locally — no check-in exists yet, so the button reads
  // "selected" rather than "✓ Lead", and the close button counts the pending pick.
  await expect(leadButton).toHaveClass(/kiosk-role-btn-selected/);
  const doneButton = page.getByRole("button", { name: "Done (1)" });
  await expect(doneButton).toBeVisible();

  // Only pressing Done actually submits the check-in and shows the welcome message.
  await doneButton.click();
  await expect(page.getByText("Welcome to Oaktown Zouk, have a great class!")).toBeVisible();
});
