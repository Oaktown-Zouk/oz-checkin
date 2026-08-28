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

test("checking in as one role disables the other role of the same class, not just other classes at that time", async ({
  page,
}) => {
  await page.goto("/api/auth/dev-login?email=claude-staff@test.com");
  await expect(page).toHaveURL("/");

  // Fixture: Checked-In Chris is already checked into Zouk L1 as Lead today.
  await page.getByPlaceholder("Search for a student by name…").fill("Checked-In Chris");
  await page.locator(".student-row", { hasText: "Checked-In Chris" }).getByRole("button", { name: "Check in to another class" }).click();

  const zoukL1Row = page.locator(".program-picker-row", { hasText: "Zouk L1" });
  await expect(zoukL1Row.getByRole("button", { name: "✓ Lead" })).toBeDisabled();
  // A student can't be Lead and Follow in the same class at the same time — Follow
  // must be disabled too, not just shown as a plain unchecked option.
  await expect(zoukL1Row.getByRole("button", { name: "Follow" })).toBeDisabled();
});
