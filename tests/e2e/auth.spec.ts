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

test("/favorites as a guest redirects to sign-in with next=/favorites", async ({ page }) => {
  await page.goto("/favorites");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Ffavorites/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("header Favorites icon navigates to the guest-protected /favorites route", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Favorites" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Ffavorites/);
});

test("/cart is accessible to a guest -- unlike /account and /favorites, it never redirects to sign-in", async ({ page }) => {
  const response = await page.goto("/cart");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole("heading", { level: 1, name: "Cart" })).toBeVisible();
});

test("header Cart icon navigates to /cart for a guest, with no sign-in redirect", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Cart" }).click();
  await expect(page).toHaveURL(/\/cart$/);
});

test("/orders as a guest redirects to sign-in with next=/orders", async ({ page }) => {
  await page.goto("/orders");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Forders/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("/orders/[publicCode] as a guest redirects to sign-in with the order path preserved as next=", async ({ page }) => {
  await page.goto("/orders/PSO-DOESNOTEXIST");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Forders%2FPSO-DOESNOTEXIST/);
});

test("/seller/orders as a guest redirects to sign-in with next=/seller/orders", async ({ page }) => {
  await page.goto("/seller/orders");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fseller%2Forders/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("/seller/orders/[publicCode] as a guest redirects to sign-in with the order path preserved as next=", async ({ page }) => {
  await page.goto("/seller/orders/PSO-DOESNOTEXIST");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fseller%2Forders%2FPSO-DOESNOTEXIST/);
});

test("/messages as a guest redirects to sign-in with next=/messages", async ({ page }) => {
  await page.goto("/messages");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fmessages/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("header Messages icon navigates to the guest-protected /messages route", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Messages" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fmessages/);
});

test("mobile bottom-nav Messages tab navigates to the guest-protected /messages route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("link", { name: "Messages" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fmessages/);
});
