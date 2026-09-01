import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("first-timer, one class: home -> count -> waiver -> free class widget -> back chain", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByRole("button", { name: "First time? Sign up for a free class" }).click();
  await expect(
    page.getByRole("heading", { name: "How many classes would you like to take on your first day?" })
  ).toBeVisible();

  await page.getByRole("button", { name: "One" }).click();
  await expect(page.getByRole("heading", { name: "Before your first class" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Code of Conduct" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Waiver of Liability" })).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Sign up for a free class" })).toBeVisible();
  await expect(page.locator('givebutter-widget[id="gOKNYY"]')).toBeAttached();

  // Back from the widget returns to the waiver, not straight to the count screen.
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.getByRole("heading", { name: "Before your first class" })).toBeVisible();

  await page.getByRole("button", { name: "← Back" }).click();
  await expect(
    page.getByRole("heading", { name: "How many classes would you like to take on your first day?" })
  ).toBeVisible();

  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.getByPlaceholder("Type your name…")).toBeVisible();
});

test("first-timer, two classes: skips the waiver and goes straight to the paid second-class widget", async ({
  page,
}) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByRole("button", { name: "First time? Sign up for a free class" }).click();
  await page.getByRole("button", { name: "Two" }).click();
  await expect(
    page.getByRole("heading", { name: "Your first class is free, your second class is $30-$40 sliding scale." })
  ).toBeVisible();
  await expect(page.locator('givebutter-widget[id="LqbDvk"]')).toBeAttached();

  await page.getByRole("button", { name: "← Back" }).click();
  await expect(
    page.getByRole("heading", { name: "How many classes would you like to take on your first day?" })
  ).toBeVisible();
});

test("drop-in flow: buy a pass -> drop-in -> one class -> widget", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByRole("button", { name: "Buy a pass" }).click();
  await expect(page.getByRole("heading", { name: "Buy a pass" })).toBeVisible();

  await page.getByRole("button", { name: "Buy a drop-in" }).click();
  await expect(page.getByRole("heading", { name: "How many classes would you like to take today?" })).toBeVisible();

  await page.getByRole("button", { name: "One" }).click();
  await expect(page.getByRole("heading", { name: "Complete your purchase" })).toBeVisible();
  await expect(page.locator('givebutter-widget[id="LqbDvk"]')).toBeAttached();

  // Back from the widget returns to the class-count screen for the same flow, not home.
  await page.getByRole("button", { name: "← Back" }).click();
  await expect(page.getByRole("heading", { name: "How many classes would you like to take today?" })).toBeVisible();
});

test("membership flow: buy a pass -> membership -> two classes/week -> widget", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByRole("button", { name: "Buy a pass" }).click();
  await page.getByRole("button", { name: "Start a Membership" }).click();
  await expect(page.getByRole("heading", { name: "How many classes would you like to take per week?" })).toBeVisible();

  await page.getByRole("button", { name: "Two" }).click();
  await expect(page.getByRole("heading", { name: "Complete your purchase" })).toBeVisible();
  await expect(page.locator('givebutter-widget[id="pnVx7r"]')).toBeAttached();
});
