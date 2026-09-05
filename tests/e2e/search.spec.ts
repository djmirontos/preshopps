import { expect, test } from "@playwright/test";

test("/search loads successfully with zero live listings", async ({ page }) => {
  const response = await page.goto("/search");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1, name: "Marketplace" })).toBeVisible();
});

test("/search?type=preloved loads safely", async ({ page }) => {
  const response = await page.goto("/search?type=preloved");
  expect(response?.ok()).toBeTruthy();
});

test("/search?q=test loads safely", async ({ page }) => {
  const response = await page.goto("/search?q=test");
  expect(response?.ok()).toBeTruthy();
  await expect(page.getByRole("heading", { level: 1, name: /search results for "test"/i })).toBeVisible();
});
