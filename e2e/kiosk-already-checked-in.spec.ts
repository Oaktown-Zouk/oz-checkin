import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("scanning/searching a student already checked in today shows the specific decline message and auto-closes", async ({
  page,
}) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByPlaceholder("Type your name…").fill("Checked-In Chris");
  await page.getByRole("button", { name: "Checked-In Chris" }).click();

  const message = page.locator(".kiosk-dialog-message");
  await expect(message).toContainText("You've already checked in for Zouk L1.");
  await expect(message).toContainText("No credits remaining for today.");

  // Auto-closes after 5s (ERROR_DISPLAY_MS in KioskPage.tsx) with no user action.
  await expect(message).not.toBeVisible({ timeout: 7000 });
});
