import { test, expect } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("kiosk-role login redirects to /kiosk, and a self-check-in submits on Check In", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByPlaceholder("Type your name…").fill("Active Amy");
  await page.getByRole("button", { name: "Active Amy" }).click();

  // Instant loading feedback before the fetch resolves — see KioskPage.tsx's
  // DialogState. Non-fatal if it resolves too fast to observe.
  await expect(page.getByText("Loading…")).toBeVisible({ timeout: 1000 }).catch(() => {});

  await expect(page.getByRole("heading", { name: "Active Amy" })).toBeVisible();
  const leadButton = page.locator(".kiosk-program-row", { hasText: "Zouk L1" }).getByRole("button", { name: "Lead" });
  await leadButton.click();

  // Tapping only picks locally — no check-in exists yet, so the button reads
  // "selected" rather than "✓ Lead", and the Check In button counts the pending pick.
  await expect(leadButton).toHaveClass(/kiosk-role-btn-selected/);
  const checkInButton = page.getByRole("button", { name: "Check In (1)" });
  await expect(checkInButton).toBeVisible();

  // Only pressing Check In actually submits the check-in and shows the welcome message.
  await checkInButton.click();
  await expect(page.getByText("Welcome to Oaktown Zouk, have a great class!")).toBeVisible();
});

test("Cancel always closes without submitting, even with a class picked; Check In is disabled with nothing picked", async ({
  page,
}) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByPlaceholder("Type your name…").fill("Active Amy");
  await page.getByRole("button", { name: "Active Amy" }).click();
  await expect(page.getByRole("heading", { name: "Active Amy" })).toBeVisible();

  // Nothing picked yet — Check In is disabled, only Cancel is usable.
  await expect(page.getByRole("button", { name: "Check In (0)" })).toBeDisabled();

  await page.locator(".kiosk-program-row", { hasText: "Zouk L1" }).getByRole("button", { name: "Lead" }).click();
  await expect(page.getByRole("button", { name: "Check In (1)" })).toBeEnabled();

  // Cancel discards the pending pick with no submission and no welcome message —
  // covers picking classes for the wrong student and backing out.
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByPlaceholder("Type your name…")).toBeVisible();
  await expect(page.getByText("Welcome to Oaktown Zouk, have a great class!")).not.toBeVisible();

  // Reopening the same student confirms nothing was actually checked in.
  await page.getByPlaceholder("Type your name…").fill("Active Amy");
  await page.getByRole("button", { name: "Active Amy" }).click();
  await expect(page.getByRole("heading", { name: "Active Amy" })).toBeVisible();
  await expect(
    page.locator(".kiosk-program-row", { hasText: "Zouk L1" }).getByRole("button", { name: "✓ Lead" })
  ).not.toBeVisible();
});

test("checking in as one role disables the other role of the same class, not just other classes at that time", async ({
  page,
}) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  await page.getByPlaceholder("Type your name…").fill("Active Amy");
  await page.getByRole("button", { name: "Active Amy" }).click();
  await expect(page.getByRole("heading", { name: "Active Amy" })).toBeVisible();
  await page.locator(".kiosk-program-row", { hasText: "Zouk L1" }).getByRole("button", { name: "Lead" }).click();
  await page.getByRole("button", { name: "Check In (1)" }).click();

  // Waits out the welcome screen's auto-close (same pattern as
  // kiosk-already-checked-in.spec.ts) so the dialog can be reopened fresh.
  await expect(page.getByText("Welcome to Oaktown Zouk, have a great class!")).not.toBeVisible({ timeout: 7000 });

  await page.getByPlaceholder("Type your name…").fill("Active Amy");
  await page.getByRole("button", { name: "Active Amy" }).click();
  await expect(page.getByRole("heading", { name: "Active Amy" })).toBeVisible();

  const zoukL1Row = page.locator(".kiosk-program-row", { hasText: "Zouk L1" });
  await expect(zoukL1Row.getByRole("button", { name: "✓ Lead" })).toBeDisabled();
  // A student can't be Lead and Follow in the same class at the same time — Follow
  // must be disabled too, not just shown as a plain unchecked option.
  await expect(zoukL1Row.getByRole("button", { name: "Follow" })).toBeDisabled();
});

test("picking a class grays out (but doesn't disable) the rest of that timeslot, and picking another switches the choice", async ({
  page,
}) => {
  await page.goto("/api/auth/dev-login?email=claude-kiosk@test.com");
  await expect(page).toHaveURL("/kiosk");

  // Fixture: Bachata L1 shares Zouk L1's 19:00 slot.
  await page.getByPlaceholder("Type your name…").fill("Active Amy");
  await page.getByRole("button", { name: "Active Amy" }).click();
  await expect(page.getByRole("heading", { name: "Active Amy" })).toBeVisible();

  const zoukL1Row = page.locator(".kiosk-program-row", { hasText: "Zouk L1" });
  const bachataL1Row = page.locator(".kiosk-program-row", { hasText: "Bachata L1" });

  await zoukL1Row.getByRole("button", { name: "Lead" }).click();
  await expect(zoukL1Row.getByRole("button", { name: "Lead" })).toHaveClass(/kiosk-role-btn-selected/);

  // The rest of the slot — including Zouk L1's own Follow — grays out, but stays
  // tappable rather than being disabled outright.
  await expect(zoukL1Row.getByRole("button", { name: "Follow" })).toHaveClass(/kiosk-role-btn-grayed/);
  await expect(zoukL1Row.getByRole("button", { name: "Follow" })).toBeEnabled();
  await expect(bachataL1Row.getByRole("button", { name: "Lead" })).toHaveClass(/kiosk-role-btn-grayed/);
  await expect(bachataL1Row.getByRole("button", { name: "Follow" })).toHaveClass(/kiosk-role-btn-grayed/);
  await expect(bachataL1Row.getByRole("button", { name: "Follow" })).toBeEnabled();

  // Picking a different option in the same slot switches the choice rather than
  // adding a second one.
  await bachataL1Row.getByRole("button", { name: "Follow" }).click();
  await expect(bachataL1Row.getByRole("button", { name: "Follow" })).toHaveClass(/kiosk-role-btn-selected/);
  await expect(zoukL1Row.getByRole("button", { name: "Lead" })).not.toHaveClass(/kiosk-role-btn-selected/);
  await expect(zoukL1Row.getByRole("button", { name: "Lead" })).toHaveClass(/kiosk-role-btn-grayed/);

  await page.getByRole("button", { name: "Check In (1)" }).click();
  await expect(page.getByText("Welcome to Oaktown Zouk, have a great class!")).toBeVisible();
});
