import { describe, expect, it } from "vitest";
import { CATEGORY_IMAGES, getCategoryImage } from "@/lib/marketplace/category-images";

const LIVE_CATEGORY_SLUGS = [
  "women",
  "men",
  "kids-baby",
  "shoes",
  "bags-accessories",
  "electronics",
  "home-living",
  "beauty-personal-care",
  "sports-hobbies",
  "cars",
  "motorcycles",
  "for-rent",
  "other",
  "pet",
  "foods",
  "bicycle",
];

describe("category-images", () => {
  it("maps every known live category slug to an asset", () => {
    for (const slug of LIVE_CATEGORY_SLUGS) {
      expect(getCategoryImage(slug), `${slug} should map to an image`).not.toBeNull();
    }
  });

  it("has exactly 16 intentional category mappings", () => {
    expect(Object.keys(CATEGORY_IMAGES)).toHaveLength(16);
  });

  it("returns null (safe fallback) for an unknown/future slug", () => {
    expect(getCategoryImage("some-future-category")).toBeNull();
  });

  it("includes Pet, Foods, and Bicycle -- not category drift", () => {
    expect(getCategoryImage("pet")).toBe("/images/categories/pet.png");
    expect(getCategoryImage("foods")).toBe("/images/categories/foods.png");
    expect(getCategoryImage("bicycle")).toBe("/images/categories/bicycle.png");
  });

  it("maps For Rent to the house-with-RENT-sign asset", () => {
    expect(getCategoryImage("for-rent")).toBe("/images/categories/rent.png");
  });

  it("maps Women to the replacement dress asset", () => {
    expect(getCategoryImage("women")).toBe("/images/categories/womens.png");
  });

  it("never keys a mapping by a numeric database id", () => {
    for (const key of Object.keys(CATEGORY_IMAGES)) {
      expect(/^\d+$/.test(key), `${key} looks like a numeric id, not a slug`).toBe(false);
    }
  });

  it("every mapped path points into the local public categories folder", () => {
    for (const value of Object.values(CATEGORY_IMAGES)) {
      expect(value.startsWith("/images/categories/")).toBe(true);
    }
  });
});
