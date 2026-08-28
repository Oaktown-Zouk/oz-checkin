import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("merging a duplicate pre-selects the record with an active membership as the survivor", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-admin@test.com");
  await expect(page).toHaveURL("/");

  await page.getByPlaceholder("Search for a student by name…").fill("Twin Tara");
  // Both duplicate rows show up on the roster today — that's the bug this feature fixes.
  await expect(page.locator(".student-row", { hasText: "Twin Tara" })).toHaveCount(2);

  // hasText with a plain string matches case-insensitively, which would match both
  // rows here — exactly the ambiguity a case-variant duplicate creates — so a
  // case-sensitive regex is needed to target only the lowercase-email row.
  await page
    .locator(".student-row", { hasText: /twin\.tara@example\.com/ })
    .getByRole("button", { name: "More actions" })
    .click();
  await page.getByRole("button", { name: "Merge duplicate…" }).click();

  await page.getByPlaceholder("Search by name…").fill("Twin Tara");
  await page.getByRole("button", { name: /Twin Tara/ }).click();

  // The membership holder should be pre-selected as the survivor once membership info
  // loads, without the user having to pick it themselves.
  const membershipHolderCard = page.locator(".merge-candidate", { hasText: /twin\.tara@example\.com/ });
  await expect(membershipHolderCard).toHaveClass(/merge-candidate-selected/);
  await expect(membershipHolderCard).toContainText("active membership");

  await page.getByRole("button", { name: "Merge" }).click();

  // The merged-away row disappears from the roster; the survivor remains.
  await expect(page.locator(".student-row", { hasText: "Twin Tara" })).toHaveCount(1);
  await expect(page.locator(".student-row", { hasText: /twin\.tara@example\.com/ })).toBeVisible();
});
