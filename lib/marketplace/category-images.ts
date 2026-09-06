/**
 * Maps each live category slug (from lib/marketplace/reference-data.ts's
 * `categories` table read) to its local `/public` image asset. Keyed by
 * the actual slug values already used by CategoryStrip's icon fallback
 * map -- not by database id, and not assumed to match the asset
 * filenames, which were named independently of the slugs.
 *
 * A slug with no entry here (e.g. a future admin-added category) is not
 * an error -- callers fall back to a neutral icon rather than breaking.
 */
export const CATEGORY_IMAGES: Record<string, string> = {
  women: "/images/categories/womens.png",
  men: "/images/categories/mens.png",
  "kids-baby": "/images/categories/kids.png",
  shoes: "/images/categories/shoes.png",
  "bags-accessories": "/images/categories/bags.png",
  electronics: "/images/categories/electronics.png",
  "home-living": "/images/categories/homes.png",
  "beauty-personal-care": "/images/categories/beauty.png",
  "sports-hobbies": "/images/categories/sports.png",
  cars: "/images/categories/car.png",
  motorcycles: "/images/categories/motorcycle.png",
  "for-rent": "/images/categories/rent.png",
  other: "/images/categories/others.png",
  pet: "/images/categories/pet.png",
  foods: "/images/categories/foods.png",
  bicycle: "/images/categories/bicycle.png",
};

export function getCategoryImage(slug: string): string | null {
  return CATEGORY_IMAGES[slug] ?? null;
}
