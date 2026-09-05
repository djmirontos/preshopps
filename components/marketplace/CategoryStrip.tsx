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

type Category = {
  label: string;
  icon: LucideIcon;
};

/** The 16 intentional categories. Icon choices are semantic approximations
 * from the single locked lucide-react set — no new icon package, no emoji. */
const CATEGORIES: Category[] = [
  { label: "Women", icon: Shirt },
  { label: "Men", icon: Watch },
  { label: "Kids & Baby", icon: Baby },
  { label: "Shoes", icon: Footprints },
  { label: "Bags & Accessories", icon: ShoppingBag },
  { label: "Electronics", icon: Smartphone },
  { label: "Home & Living", icon: Sofa },
  { label: "Beauty & Personal Care", icon: Sparkles },
  { label: "Sports & Hobbies", icon: Dumbbell },
  { label: "Cars", icon: Car },
  { label: "Motorcycles", icon: Motorbike },
  { label: "For Rent", icon: Key },
  { label: "Other", icon: LayoutGrid },
  { label: "Pet", icon: PawPrint },
  { label: "Foods", icon: Utensils },
  { label: "Bicycle", icon: Bike },
];

/**
 * Horizontal-scroll icon+label strip. No filtering logic yet — links are
 * inert placeholders. Inquiry-only categories (Cars, Motorcycles, For Rent)
 * get no special visual treatment here; that distinction is handled later
 * on the listing detail page, not in the category chip itself.
 */
export function CategoryStrip() {
  return (
    <section aria-labelledby="categories-heading" className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <h2 id="categories-heading" className="sr-only">
        Browse categories
      </h2>
      <ul className="flex snap-x snap-proximity gap-4 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {CATEGORIES.map(({ label, icon: Icon }) => (
          <li key={label} className="flex shrink-0 snap-start flex-col items-center gap-1.5">
            <Link
              href="#"
              aria-label={label}
              className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-surface text-ink-secondary transition-colors duration-150 hover:border-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </Link>
            <span className="w-16 truncate text-center text-[11px] text-ink-secondary">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
