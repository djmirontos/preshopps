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

test("hero is hidden below 1024px -- mobile goes straight from search into categories", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toBeHidden();
  await expect(page.getByRole("link", { name: "Women" })).toBeVisible();
});

test("hero (text-only, no CTAs) is visible at 1024px+", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { level: 1, name: "Find something worth loving again." }),
  ).toBeVisible();
  await expect(
    page.getByText("Buy and sell pre-loved and brand-new items from local sellers."),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /browse items/i })).toHaveCount(0);
  await expect(page.getByText(/start selling/i)).toHaveCount(0);
});
