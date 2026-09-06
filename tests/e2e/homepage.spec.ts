import { expect, test } from "@playwright/test";

test("homepage loads", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.ok()).toBeTruthy();
  await expect(page).toHaveTitle("Preshopps");
});

test("homepage renders real category images that still link to /search?category=", async ({ page }) => {
  await page.goto("/");

  const categoryLink = page.getByRole("link", { name: "Women" });
  await expect(categoryLink).toHaveAttribute("href", "/search?category=women");
  await expect(categoryLink.locator("img")).toHaveAttribute("src", /womens\.png/);

  await categoryLink.click();
  await expect(page).toHaveURL(/\/search\?category=women/);
});
