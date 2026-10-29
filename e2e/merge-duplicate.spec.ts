import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("a student removed from Givebutter can be marked as a duplicate of the kept record", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-admin@test.com");
  await expect(page).toHaveURL("/");

  await page.getByPlaceholder("Search for a student by name…").fill("Twin Tara");
  await expect(page.locator(".student-row", { hasText: "Twin Tara" })).toHaveCount(2);

  // hasText with a plain string matches case-insensitively, which would match both
  // rows here, so case-sensitive regexes target each row by its email's casing.
  const keptRow = page.locator(".student-row", { hasText: /twin\.tara@example\.com/ });
  const removedRow = page.locator(".student-row", { hasText: /Twin\.Tara@Example\.com/ });

  await expect(removedRow).toContainText("Removed from Givebutter");

  // Only the removed row offers the action.
  await keptRow.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("button", { name: "Mark as duplicate…" })).toHaveCount(0);
  await page.getByRole("heading", { name: "OZ Check-In" }).click();

  await removedRow.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Mark as duplicate…" }).click();

  // The removed row itself is left out of the search, so one result remains.
  await page.getByPlaceholder("Search by name…").fill("Twin Tara");
  await page.getByRole("button", { name: /Twin Tara/ }).click();
  await expect(page.locator(".merge-candidate")).toContainText("active membership");

  await page.getByRole("button", { name: "Mark as duplicate" }).click();

  // The marked row disappears from the roster right away; the kept record remains.
  await expect(page.locator(".student-row", { hasText: "Twin Tara" })).toHaveCount(1);
  await expect(keptRow).toBeVisible();
});
