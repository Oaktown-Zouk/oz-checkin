import { test, expect } from "@playwright/test";

// Points at the separate student app (web-student/ + server/src/studentApp.ts), not
// the staff baseURL every other spec in this suite uses — see
// e2e/playwright.config.ts's STUDENT_WEB_PORT.
test.use({ baseURL: "http://localhost:9999" });

// No beforeEach reset-mock here on purpose: studentApp.ts has exactly one data route
// (GET /api/me/timeline) and it's read-only, so nothing in this spec ever mutates the
// mock store — there's nothing to reset between tests.
test("student self-login lands on their own read-only page with no write UI at all", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-student@test.com");
  await expect(page).toHaveURL("/");

  await expect(page.getByRole("heading", { name: "Claude Test Student" })).toBeVisible();
  await expect(page.getByText("claude-student@test.com")).toBeVisible();

  // Not just hidden — this app never imports the components that would render these,
  // so there's nothing to find regardless of session/permissions.
  await expect(page.getByRole("button", { name: "Add note" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Transfer membership" })).toHaveCount(0);

  // Log out lives inside the nav menu (see NavMenu.tsx), not a standalone button.
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("button", { name: "My Progress" })).toBeVisible();
  await expect(page.getByRole("button", { name: "QR Code" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
});

test("the QR Code nav item shows a check-in QR code, and switching back works", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-student@test.com");
  await expect(page.getByRole("heading", { name: "Claude Test Student" })).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "QR Code" }).click();

  const qrImage = page.getByRole("img", { name: "Your check-in QR code" });
  await expect(qrImage).toBeVisible();
  await expect(qrImage).toHaveAttribute("src", /^data:image\/png;base64,/);

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "My Progress" }).click();
  await expect(page.getByText("Total check-ins")).toBeVisible();
});

test("logging out returns to the sign-in screen", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=claude-student@test.com");
  await expect(page.getByRole("heading", { name: "Claude Test Student" })).toBeVisible();

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL("/");
  // A real <a href> (Google needs to redirect the browser itself), so its ARIA role
  // is "link," not "button" — see shared/src/components/GoogleLogo.tsx's caller.
  await expect(page.getByRole("link", { name: "Sign in with Google" })).toBeVisible();
});

test("GET /api/me/timeline requires a valid Student session", async ({ request }) => {
  const res = await request.get("/api/me/timeline");
  expect(res.status()).toBe(401);
});

test("dev-login rejects any email other than the one fixed test identity", async ({ page }) => {
  await page.goto("/api/auth/dev-login?email=someone-else@example.com");
  const body = await page.textContent("body");
  expect(body).toContain("isn't allowed to use dev-login");
});
