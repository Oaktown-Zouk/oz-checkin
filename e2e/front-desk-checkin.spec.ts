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

test("picking a class grays out (but doesn't disable) the rest of that timeslot, and picking another switches the choice", async ({
  page,
}) => {
  await page.goto("/api/auth/dev-login?email=claude-staff@test.com");
  await expect(page).toHaveURL("/");

  // Fixture: Bachata L1 shares Zouk L1's 19:00 slot.
  await page.getByPlaceholder("Search for a student by name…").fill("Active Amy");
  await page.locator(".student-row", { hasText: "Active Amy" }).getByRole("button", { name: "Check In" }).click();

  const zoukL1Row = page.locator(".program-picker-row", { hasText: "Zouk L1" });
  const bachataL1Row = page.locator(".program-picker-row", { hasText: "Bachata L1" });

  await zoukL1Row.getByRole("button", { name: "Lead" }).click();
  await expect(zoukL1Row.getByRole("button", { name: "Lead" })).toHaveClass(/role-toggle-selected/);

  // The rest of the slot — including Zouk L1's own Follow — grays out, but stays
  // clickable rather than being disabled outright.
  await expect(zoukL1Row.getByRole("button", { name: "Follow" })).toHaveClass(/role-toggle-grayed/);
  await expect(zoukL1Row.getByRole("button", { name: "Follow" })).toBeEnabled();
  await expect(bachataL1Row.getByRole("button", { name: "Lead" })).toHaveClass(/role-toggle-grayed/);
  await expect(bachataL1Row.getByRole("button", { name: "Follow" })).toHaveClass(/role-toggle-grayed/);
  await expect(bachataL1Row.getByRole("button", { name: "Follow" })).toBeEnabled();

  // Picking a different option in the same slot switches the choice rather than
  // adding a second one.
  await bachataL1Row.getByRole("button", { name: "Follow" }).click();
  await expect(bachataL1Row.getByRole("button", { name: "Follow" })).toHaveClass(/role-toggle-selected/);
  await expect(zoukL1Row.getByRole("button", { name: "Lead" })).not.toHaveClass(/role-toggle-selected/);
  await expect(zoukL1Row.getByRole("button", { name: "Lead" })).toHaveClass(/role-toggle-grayed/);

  await page.getByRole("button", { name: /Check in \(1\)/ }).click();
  await page.locator(".student-row", { hasText: "Active Amy" }).getByRole("button", { name: "Check in to another class" }).click();
  await expect(page.locator(".program-picker-row", { hasText: "Bachata L1" }).getByRole("button", { name: "✓ Follow" })).toBeVisible();
});
