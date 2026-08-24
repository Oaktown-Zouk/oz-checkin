import { test, expect } from "@playwright/test";
import { KIOSK_PASSWORD_LOGIN } from "../server/src/airtable/sandboxSeed.js";

test.beforeEach(async ({ request }) => {
  await request.post("/api/dev/reset-mock");
});

test("wrong password shows an inline error and doesn't sign in", async ({ page }) => {
  await page.goto("/kiosk");
  await expect(page.getByRole("heading", { name: "Oaktown Zouk Kiosk" })).toBeVisible();

  await page.getByPlaceholder("Login").fill(KIOSK_PASSWORD_LOGIN.identifier);
  await page.getByPlaceholder("Password").fill("not the right password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Invalid login or password.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Oaktown Zouk Kiosk" })).toBeVisible();
});

test("correct identifier/password signs in and lands on the kiosk roster", async ({ page }) => {
  await page.goto("/kiosk");

  await page.getByPlaceholder("Login").fill(KIOSK_PASSWORD_LOGIN.identifier);
  await page.getByPlaceholder("Password").fill(KIOSK_PASSWORD_LOGIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL("/kiosk");
  await expect(page.getByPlaceholder("Or type your name…")).toBeVisible();
});
