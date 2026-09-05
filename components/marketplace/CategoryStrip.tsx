import Link from "next/link";
import {
  Baby,
  Bike,
  Car,
  Dumbbell,
  Footprints,
  Key,
  LayoutGrid,
  Motorbike,
  PawPrint,
  Shirt,
  ShoppingBag,
  Smartphone,
  Sofa,
  Sparkles,
  Utensils,
  Watch,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CategoryRef } from "@/lib/marketplace/reference-data";

/** Icon choices are semantic approximations from the single locked
 * lucide-react set, keyed by the live category slug -- no new icon
 * package, no emoji. Any category slug not in this map (e.g. a future
 * admin-added category) falls back to LayoutGrid rather than breaking. */
const CATEGORY_ICONS: Record<string, LucideIcon> = {
  women: Shirt,
  men: Watch,
  "kids-baby": Baby,
  shoes: Footprints,
  "bags-accessories": ShoppingBag,
  electronics: Smartphone,
  "home-living": Sofa,
  "beauty-personal-care": Sparkles,
  "sports-hobbies": Dumbbell,
  cars: Car,
  motorcycles: Motorbike,
  "for-rent": Key,
  other: LayoutGrid,
  pet: PawPrint,
  foods: Utensils,
  bicycle: Bike,
};

/**
 * Horizontal-scroll icon+label strip backed by live categories (fetched
 * via the public-safe reference-data path, not hardcoded). Each item
 * links to /search?category={slug}. Inquiry-only categories (Cars,
 * Motorcycles, For Rent) get no special visual treatment here -- that
 * distinction belongs to the listing detail page, not this chip.
 */
export function CategoryStrip({ categories }: { categories: CategoryRef[] }) {
  if (categories.length === 0) return null;

  return (
    <section aria-labelledby="categories-heading" className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <h2 id="categories-heading" className="sr-only">
        Browse categories
      </h2>
      <ul className="flex snap-x snap-proximity gap-4 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {categories.map(({ id, slug, name }) => {
          const Icon = CATEGORY_ICONS[slug] ?? LayoutGrid;
          return (
            <li key={id} className="flex shrink-0 snap-start flex-col items-center gap-1.5">
              <Link
                href={`/search?category=${slug}`}
                aria-label={name}
                className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface text-ink-secondary transition-colors duration-150 hover:border-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
              </Link>
              <span className="w-16 truncate text-center text-[11px] text-ink-secondary">{name}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
