import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("a note's author can edit it; other staff can view but not edit it", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-staff@test.com");
  await expect(page).toHaveURL("/");

  await page.getByPlaceholder("Search for a student by name…").fill("Active Amy");
  await page.locator(".student-row", { hasText: "Active Amy" }).getByRole("link", { name: "Active Amy" }).click();
  await expect(page.getByRole("heading", { name: "Active Amy" })).toBeVisible();

  await page.getByRole("button", { name: "Add note" }).click();
  await page.locator("#note-summary").fill("Great progress this week");
  await page.getByRole("button", { name: "Save" }).click();

  const noteRow = page.getByRole("button", { name: /Great progress this week/ });
  await expect(noteRow).toBeVisible();
  await noteRow.click();

  await expect(page.getByRole("heading", { name: /Note from/ })).toBeVisible();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.locator("#note-summary").fill("Updated after class");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("button", { name: /Updated after class/ })).toBeVisible();

  // A different staff account can see the note but has no way to edit it.
  await page.goto("/api/auth/dev-login?email=claude-admin@test.com");
  await page.getByPlaceholder("Search for a student by name…").fill("Active Amy");
  await page.locator(".student-row", { hasText: "Active Amy" }).getByRole("link", { name: "Active Amy" }).click();
  await page.getByRole("button", { name: /Updated after class/ }).click();
  await expect(page.getByRole("heading", { name: /Note from/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).not.toBeVisible();
});
