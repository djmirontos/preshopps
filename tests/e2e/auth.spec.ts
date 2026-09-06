import { expect, test } from "@playwright/test";

test("/sign-in loads", async ({ page }) => {
  const response = await page.goto("/sign-in");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("/sign-up loads", async ({ page }) => {
  const response = await page.goto("/sign-up");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
});

test("/forgot-password loads", async ({ page }) => {
  const response = await page.goto("/forgot-password");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1, name: "Forgot your password?" })).toBeVisible();
});

test("/account as a guest redirects to sign-in with next=/account", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});
