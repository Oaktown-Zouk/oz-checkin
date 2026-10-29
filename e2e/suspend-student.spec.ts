import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("suspending a student from the roster blocks check-in and shows on their timeline; unsuspending lifts it", async ({
  page,
}) => {
  await page.goto("/api/auth/dev-login?email=claude-admin@test.com");
  await expect(page).toHaveURL("/");

  await page.getByPlaceholder("Search for a student by name…").fill("Active Amy");
  const row = page.locator(".student-row", { hasText: "Active Amy" });

  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Suspend", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Suspend Active Amy?" })).toBeVisible();
  await page.locator(".dialog-card").getByRole("button", { name: "Suspend", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Suspend Active Amy?" })).not.toBeVisible();

  // Check In now shows the suspension notice in place of the check-in dialog.
  await row.getByRole("button", { name: "Check In" }).click();
  await expect(page.getByText("This student has been suspended")).toBeVisible();
  await page.getByRole("button", { name: "OK" }).click();

  // The student page offers the same Actions menu, and the timeline shows the suspension.
  await row.getByRole("link", { name: "Active Amy" }).click();
  await expect(page.locator(".timeline-event-suspended")).toContainText("Suspended by Ada");

  await page.getByRole("button", { name: "Actions ▾" }).click();
  await expect(page.getByRole("button", { name: "Transfer membership" })).toBeVisible();
  await page.getByRole("button", { name: "Unsuspend" }).click();
  await page.locator(".dialog-card").getByRole("button", { name: "Unsuspend" }).click();
  // Lifting keeps the suspension as history, alongside the lifting itself.
  await expect(page.locator(".timeline-event-suspension_lifted")).toContainText("Suspension lifted by Ada");
  await expect(page.locator(".timeline-event-suspended")).toHaveCount(1);
  await page.getByRole("button", { name: "Actions ▾" }).click();
  await expect(page.getByRole("button", { name: "Suspend", exact: true })).toBeVisible();
});
