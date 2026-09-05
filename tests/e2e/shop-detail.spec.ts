import { expect, test } from "@playwright/test";

test("/shop/{slug} does not crash and returns a not-found response for an unknown shop", async ({ page }) => {
  const response = await page.goto("/shop/nonexistent-shop");
  expect(response?.status()).toBe(404);
});
