import { expect, test } from "@playwright/test";

test("/item/{publicCode} does not crash and returns a not-found response for an unknown code", async ({
  page,
}) => {
  const response = await page.goto("/item/PLS-NONEXISTENT");
  expect(response?.status()).toBe(404);
});
