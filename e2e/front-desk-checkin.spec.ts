import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("staff checks a student into a class and the row updates", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-staff@test.com");
  await expect(page).toHaveURL("/");

  await page.getByPlaceholder("Search for a student by name…").fill("Active Amy");
  const row = page.locator(".student-row", { hasText: "Active Amy" });
  await row.getByRole("button", { name: "Check In" }).click();

  await expect(page.getByRole("heading", { name: "Check in Active Amy" })).toBeVisible();
  await page.locator(".program-picker-row", { hasText: "Zouk L1" }).getByRole("button", { name: "Lead" }).click();
  await page.getByRole("button", { name: /Check in \(1\)/ }).click();

  await expect(page.getByRole("heading", { name: "Check in Active Amy" })).not.toBeVisible();
  await expect(row.getByRole("button", { name: "Check in to another class" })).toBeVisible();
});
