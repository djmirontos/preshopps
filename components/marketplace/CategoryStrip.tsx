import Image from "next/image";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CategoryRef } from "@/lib/marketplace/reference-data";
import { getCategoryImage } from "@/lib/marketplace/category-images";

/** Fallback only -- used for a category slug with no image mapping (e.g.
 * a future admin-added category not yet covered by category-images.ts).
 * Every currently-live category has a real image, so this normally never
 * renders. */
const FALLBACK_ICON: LucideIcon = LayoutGrid;

/**
 * Horizontal-scroll image+label strip backed by live categories (fetched
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
          const imageSrc = getCategoryImage(slug);
          return (
            <li key={id} className="flex shrink-0 snap-start flex-col items-center gap-1.5">
              <Link
                href={`/search?category=${slug}`}
                aria-label={name}
                className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface p-2.5 transition-colors duration-150 hover:border-brand hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand lg:h-20 lg:w-20 lg:p-3"
              >
                {imageSrc ? (
                  <Image
                    src={imageSrc}
                    alt=""
                    width={64}
                    height={64}
                    sizes="(min-width: 1024px) 80px, 64px"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <FALLBACK_ICON className="h-5 w-5 text-ink-secondary" aria-hidden="true" />
                )}
              </Link>
              <span className="w-16 truncate text-center text-[11px] text-ink-secondary lg:w-24 lg:whitespace-normal lg:text-xs lg:leading-tight">
                {name}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
