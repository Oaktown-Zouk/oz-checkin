import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("sign-up flow: home -> signup widget -> back to home", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByRole("button", { name: "First time? Sign up for a free class" }).click();
  await expect(page.getByRole("heading", { name: "Sign up for a free class" })).toBeVisible();
  await expect(page.locator('givebutter-widget[id="gOKNYY"]')).toBeAttached();

  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.getByPlaceholder("Type your name…")).toBeVisible();
});

test("drop-in flow: buy a pass -> drop-in -> one class -> QR -> pay on tablet", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByRole("button", { name: "Buy a pass" }).click();
  await expect(page.getByRole("heading", { name: "Buy a pass" })).toBeVisible();

  await page.getByRole("button", { name: "Buy a drop-in" }).click();
  await expect(page.getByRole("heading", { name: "How many classes would you like to take today?" })).toBeVisible();

  await page.getByRole("button", { name: "One" }).click();
  await expect(page.getByRole("heading", { name: "Scan QR code to buy on your phone" })).toBeVisible();
  await expect(page.getByAltText("QR code to complete your purchase on Givebutter")).toBeVisible();

  await page.getByRole("button", { name: "Or pay on this tablet" }).click();
  await expect(page.getByRole("heading", { name: "Complete your purchase" })).toBeVisible();
  await expect(page.locator('givebutter-widget[id="LqbDvk"]')).toBeAttached();

  // Back from the widget returns to the QR screen for the same product, not home.
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.getByRole("heading", { name: "Scan QR code to buy on your phone" })).toBeVisible();
});

test("membership flow: buy a pass -> membership -> two classes/week -> QR", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByRole("button", { name: "Buy a pass" }).click();
  await page.getByRole("button", { name: "Start a Membership" }).click();
  await expect(page.getByRole("heading", { name: "How many classes would you like to take per week?" })).toBeVisible();

  await page.getByRole("button", { name: "Two" }).click();
  await expect(page.getByRole("heading", { name: "Scan QR code to buy on your phone" })).toBeVisible();

  await page.getByRole("button", { name: "Or pay on this tablet" }).click();
  await expect(page.locator('givebutter-widget[id="pnVx7r"]')).toBeAttached();
});
